import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@shared/errors/app-error.js";
import { getAppVersionInfo } from "./app-version.service.js";

// In-app updater (service & portable modes). The server can't replace its own
// files while running, so it downloads the light app-update zip, verifies the
// sha256 published with the release, then spawns a detached PowerShell script
// (scripts/update-apply.ps1) that does backup -> stop -> swap -> health check
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
  const scriptShips = existsSync(
    path.join(appDir, "scripts", "update-apply.ps1")
  );
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
  mkdirSync(paths.stagingDir, { recursive: true });
  const setStatus = (s: UpdateStatus) =>
    writeFileSync(paths.statusFile, JSON.stringify(s));
  const now = () => new Date().toISOString();

  setStatus({ state: "downloading", detail: state.latest, updatedAt: now() });
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
    throw new AppError("VALIDATION_ERROR", {
      reason: "update download failed",
    });
  }

  // Run the apply script from staging — the app dir is about to be replaced.
  await copyFile(
    path.join(paths.appDir, "scripts", "update-apply.ps1"),
    paths.applyScript
  );

  setStatus({ state: "starting", detail: "", updatedAt: now() });
  const child = spawn(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      paths.applyScript,
      "-Mode",
      state.installMode,
      "-InstallRoot",
      paths.installRoot,
      "-ZipPath",
      paths.zipFile,
      "-StatusPath",
      paths.statusFile,
      "-BackupScript",
      paths.backupScript,
    ],
    { detached: true, stdio: "ignore", windowsHide: true }
  );
  child.unref();

  return { ...state, status: readUpdateStatus(paths.statusFile) };
}
