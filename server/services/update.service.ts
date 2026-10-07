import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@shared/errors/app-error.js";
import { logger } from "../utils/logger.js";
import { getAppVersionInfo } from "./app-version.service.js";

// In-app updater (service & portable modes). The server can't replace its own
// files while running, so it downloads the light app-update zip, verifies the
// sha256 published with the release, then spawns a detached PowerShell script
// (scripts/update-launch.ps1 -> Win32_Process.Create -> update-apply.ps1,
// outside our process tree — a detached child would die with the service)
// -> rollback. Progress lives in a JSON status file that survives restarts —
// the updated server reads it when it comes back up.

export type InstallMode = "docker" | "service" | "portable" | "other";

export type UpdatePhase =
  | "idle"
  | "downloading"
  | "starting"
  | "backing_up"
  | "stopping"
  | "applying"
  | "restarting"
  | "rolling_back"
  | "done"
  | "rolled_back"
  | "failed";

export interface UpdateStatus {
  detail: string;
  state: UpdatePhase;
  updatedAt: string;
}

export interface UpdateState {
  canSelfUpdate: boolean;
  current: string;
  installMode: InstallMode;
  latest: string | null;
  releaseUrl: string | null;
  status: UpdateStatus;
  updateAvailable: boolean;
}

const UPDATE_ZIP = "oficinaos-app-update.zip";
const UPDATE_SHA = "oficinaos-app-update.zip.sha256";
const RELEASES_LATEST_DOWNLOAD =
  "https://github.com/braindeadpt/OficinaOS/releases/latest/download";
const IN_PROGRESS: ReadonlySet<UpdatePhase> = new Set([
  "downloading",
  "starting",
  "backing_up",
  "stopping",
  "applying",
  "restarting",
  "rolling_back",
]);
// An update involves a large download + DB backup + migration — if the status
// file is this old and still "in progress" the script died with the server.
const STALE_MS = 45 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

const IDLE: UpdateStatus = {
  state: "idle",
  detail: "",
  updatedAt: "",
};

interface Paths {
  appDir: string;
  applyScript: string;
  backupScript: string;
  installRoot: string;
  launchScript: string;
  stagingDir: string;
  statusFile: string;
  workDir: string;
  zipFile: string;
}

export function buildPaths(
  mode: InstallMode,
  appDir: string,
  programData: string
): Paths {
  // Windows-only paths (Program Files, ProgramData, .ps1 scripts) — force
  // win32 semantics so behaviour is identical wherever the caller runs.
  const installRoot = path.win32.dirname(appDir);
  const workDir =
    mode === "service"
      ? path.win32.join(programData, "OficinaOS")
      : path.win32.join(installRoot, "data");
  const stagingDir = path.win32.join(workDir, "update");
  return {
    appDir,
    installRoot,
    workDir,
    stagingDir,
    statusFile: path.win32.join(stagingDir, "status.json"),
    zipFile: path.win32.join(stagingDir, UPDATE_ZIP),
    backupScript:
      mode === "service"
        ? path.win32.join(installRoot, "tools", "backup.ps1")
        : path.win32.join(installRoot, "BACKUP.ps1"),
    applyScript: path.win32.join(stagingDir, "update-apply.ps1"),
    launchScript: path.win32.join(appDir, "scripts", "update-launch.ps1"),
  };
}

type ExecFn = (file: string, args: readonly string[]) => unknown;

const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { stdio: "ignore" });

export function detectInstallMode(
  platform: NodeJS.Platform = process.platform,
  dockerEnvFile = "/.dockerenv",
  execImpl: ExecFn = defaultExec
): InstallMode {
  if (existsSync(dockerEnvFile)) {
    return "docker";
  }
  if (platform !== "win32") {
    return "other";
  }
  try {
    execImpl("sc.exe", ["query", "OficinaOS"]);
    return "service";
  } catch {
    return "portable";
  }
}

export function readUpdateStatus(statusFile: string): UpdateStatus {
  try {
    const parsed = JSON.parse(
      readFileSync(statusFile, "utf-8")
    ) as UpdateStatus;
    if (!parsed.state) {
      return IDLE;
    }
    if (
      IN_PROGRESS.has(parsed.state) &&
      Date.now() - statSync(statusFile).mtimeMs > STALE_MS
    ) {
      return {
        state: "failed",
        detail: "o processo de atualização morreu antes de terminar",
        updatedAt: parsed.updatedAt,
      };
    }
    return parsed;
  } catch {
    return IDLE;
  }
}

export function isUpdateInProgress(status: UpdateStatus): boolean {
  return IN_PROGRESS.has(status.state);
}

export function verifySha256(file: string, expected: string): boolean {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  // sha256sum format ("hash  filename") or bare hash — first token is the digest
  const hex = expected.trim().toLowerCase().split(" ")[0];
  return actual === hex;
}

export async function getUpdateState(): Promise<UpdateState> {
  const info = await getAppVersionInfo();
  const installMode = detectInstallMode();
  const appDir = process.cwd();
  const paths = buildPaths(installMode, appDir, process.env.ProgramData ?? "");
  const scriptShips =
    existsSync(path.join(appDir, "scripts", "update-apply.ps1")) &&
    existsSync(path.join(appDir, "scripts", "update-launch.ps1"));
  const canSelfUpdate =
    (installMode === "service" || installMode === "portable") && scriptShips;
  return {
    ...info,
    installMode,
    canSelfUpdate,
    status: canSelfUpdate ? readUpdateStatus(paths.statusFile) : IDLE,
  };
}

async function downloadFile(
  url: string,
  dest: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!(res.ok && res.body)) {
    throw new Error(`download falhou: HTTP ${res.status}`);
  }
  await pipeline(
    Readable.fromWeb(
      res.body as unknown as import("node:stream/web").ReadableStream
    ),
    createWriteStream(dest)
  );
}

function secureStagingDir(dir: string, strict: boolean): void {
  // O staging dir recebe o zip antes da verificacao — so a conta da
  // instalacao, SYSTEM e Administradores podem escrever. Sem isto, qualquer
  // utilizador local podia substituir o zip entre o download e o swap.
  try {
    const user = execFileSync("whoami", { encoding: "utf-8" }).trim();
    execFileSync(
      "icacls",
      [
        dir,
        "/inheritance:r",
        "/grant:r",
        `${user}:(OI)(CI)F`,
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
      ],
      { stdio: "ignore" }
    );
  } catch (err) {
    // Em modo servico o staging vive em ProgramData (qualquer user escreve
    // la): sem a ACL o ataque fica em aberto — abortar, nao continuar.
    if (strict) {
      throw new AppError("INTERNAL_ERROR", {
        reason: `staging ACL failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }
}

async function applyUpdate(
  state: UpdateState,
  paths: Paths,
  setStatus: (s: UpdateStatus) => void,
  fetchImpl: typeof fetch
): Promise<void> {
  const now = () => new Date().toISOString();
  try {
    const shaFile = path.join(paths.stagingDir, UPDATE_SHA);
    await Promise.all([
      downloadFile(
        `${RELEASES_LATEST_DOWNLOAD}/${UPDATE_ZIP}`,
        paths.zipFile,
        fetchImpl
      ),
      downloadFile(
        `${RELEASES_LATEST_DOWNLOAD}/${UPDATE_SHA}`,
        shaFile,
        fetchImpl
      ),
    ]);
    const sha = await readFile(shaFile, "utf-8");
    if (!verifySha256(paths.zipFile, sha)) {
      throw new Error(
        "sha256 não corresponde — download corrompido ou adulterado"
      );
    }
  } catch (err) {
    setStatus({
      state: "failed",
      detail: err instanceof Error ? err.message : "download falhou",
      updatedAt: now(),
    });
    return;
  }

  // Run the apply script from staging — the app dir is about to be replaced.
  await copyFile(
    path.join(paths.appDir, "scripts", "update-apply.ps1"),
    paths.applyScript
  );

  setStatus({ state: "starting", detail: "", updatedAt: now() });
  // Win32_Process.Create (update-launch.ps1) cria o updater fora da nossa
  // arvore — detached NAO muda o pai no Windows e um processo filho do
  // bun.exe morria com ele no Stop-Service, a meio da troca de ficheiros.
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const applyCmd = [
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    q(paths.applyScript),
    "-Mode",
    state.installMode,
    "-InstallRoot",
    q(paths.installRoot),
    "-ZipPath",
    q(paths.zipFile),
    "-StatusPath",
    q(paths.statusFile),
    "-BackupScript",
    q(paths.backupScript),
  ].join(" ");
  spawn(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      paths.launchScript,
      "-CommandLine",
      applyCmd,
      "-StatusPath",
      paths.statusFile,
    ],
    { stdio: "ignore", windowsHide: true }
  ).unref();
}

export async function startUpdate(
  fetchImpl: typeof fetch = fetch
): Promise<UpdateState> {
  const state = await getUpdateState();
  if (!(state.updateAvailable && state.latest)) {
    throw new AppError("VALIDATION_ERROR", { reason: "no update available" });
  }
  if (!state.canSelfUpdate) {
    throw new AppError("VALIDATION_ERROR", {
      reason: `self-update not supported in ${state.installMode} mode`,
    });
  }
  if (isUpdateInProgress(state.status)) {
    throw new AppError("CONFLICT", { reason: "update already running" });
  }

  const paths = buildPaths(
    state.installMode,
    process.cwd(),
    process.env.ProgramData ?? ""
  );
  // Apagar e recriar: um utilizador local que criasse a pasta antes ficava
  // dono dela — e o owner pode sempre reescrever a ACL (WRITE_DAC implicito).
  // Recriada em cada update, o dono e a conta da instalacao.
  rmSync(paths.stagingDir, { recursive: true, force: true });
  mkdirSync(paths.stagingDir, { recursive: true });
  secureStagingDir(paths.stagingDir, state.installMode === "service");
  const setStatus = (s: UpdateStatus) =>
    writeFileSync(paths.statusFile, JSON.stringify(s));
  const now = () => new Date().toISOString();

  setStatus({ state: "downloading", detail: state.latest, updatedAt: now() });

  // O download (~90 MB) corre em background — a rota responde logo e o
  // cliente acompanha via GET /settings/update/status (o timeout de 15 s
  // do axios cortava o POST a meio do download). Erros vão para o status
  // file; o catch aqui só impede um unhandled rejection.
  applyUpdate(state, paths, setStatus, fetchImpl).catch((err) =>
    logger.error({ err }, "update apply failed")
  );

  return { ...state, status: readUpdateStatus(paths.statusFile) };
}
