/**
 * Migração de privacidade do livro de ponto: apaga os ficheiros das
 * fotografias de prova em UPLOAD_DIR/ponto-photos e as cópias retidas
 * pelo atualizador/instalador. Corre no arranque como parte de
 * `bun run db:migrate-deploy` — é idempotente e NUNCA bloqueia o
 * arranque: o que não se conseguir apagar fica na base de dados (a
 * linha só é removida quando todas as cópias do ficheiro desaparecem),
 * aparece no aviso das Definições do ponto e é tentado de novo no
 * arranque seguinte.
 *
 * Modelo por fotografia (decisão do dono): a linha de cada foto em
 * ponto_photos só é apagada se o ficheiro dela — em <uploads>/ e em
 * TODAS as cópias de backup (app.prev, oficinaos-keep-*) — tiver sido
 * apagado com sucesso. Uma reversão da atualização nunca perde o acesso
 * a fotografias que continuem em disco.
 *
 * A limpeza cobre TODAS as cópias que o atualizador/instalador podem
 * reter, porque a decisão do dono é "nada fica connosco":
 * - a pasta ativa <uploads>/ponto-photos;
 * - as instalações anteriores preservadas para rollback pelo
 *   update-apply.ps1 — <root>/app.prev…/uploads/ponto-photos;
 * - as cópias temporárias %TEMP%/oficinaos-keep-…/uploads/ponto-photos.
 *
 * Segurança: os caminhos guardados na BD são dados — nunca se apaga
 * fora das bases conhecidas. Caminhos UNC/rede, absolutos fora da base,
 * com ".." ou através de ligações simbólicas que apontem para fora são
 * recusados e ficam registados no relatório.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const PHOTO_SUBDIR = "ponto-photos";
const DRIVE_PREFIX = /^[a-zA-Z]:/;

async function isDir(root: string): Promise<boolean> {
  const stat = await fs.lstat(root).catch(() => null);
  return stat?.isDirectory() === true;
}

/**
 * Todas as bases de uploads conhecidas: a ativa mais as cópias de
 * backup criadas pelo atualizador/instalador. A derivação do layout
 * portátil só acontece quando uploadDir é mesmo <root>/app/uploads —
 * um UPLOAD_DIR personalizado noutro sítio não leva a varrer pastas
 * alheias.
 */
export async function candidateUploadsBases(uploadDir: string): Promise<{
  active: string;
  backups: string[];
  listFailures: string[];
}> {
  const active = path.resolve(uploadDir);
  const backups: string[] = [];
  const listFailures: string[] = [];
  const appDir = path.dirname(active);
  if (path.basename(active) === "uploads" && path.basename(appDir) === "app") {
    const installRoot = path.dirname(appDir);
    const entries = await fs
      .readdir(installRoot, { withFileTypes: true })
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") {
          // Falhar a listagem NÃO pode ser silencioso: pode haver cópias
          // app.prev por encontrar — o dono tem de as apagar à mão.
          listFailures.push(
            path.join(installRoot, "app.prev*", "uploads", PHOTO_SUBDIR)
          );
        }
        return [];
      });
    for (const entry of entries) {
      // O update-apply.ps1 usa exatamente "app.prev"; o prefixo cobre
      // variantes futuras (app.prev.1, app.prev-old) sem tocar em pastas
      // alheias como "app" ou "approvals".
      if (!(entry.isDirectory() && entry.name.startsWith("app.prev"))) {
        continue;
      }
      backups.push(path.join(installRoot, entry.name, "uploads"));
    }
  }
  const temp = process.env.TEMP ?? process.env.TMP;
  if (temp && (await isDir(temp))) {
    const entries = await fs
      .readdir(temp, { withFileTypes: true })
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") {
          listFailures.push(
            path.join(temp, "oficinaos-keep-*", "uploads", PHOTO_SUBDIR)
          );
        }
        return [];
      });
    for (const entry of entries) {
      if (!(entry.isDirectory() && entry.name.startsWith("oficinaos-keep-"))) {
        continue;
      }
      backups.push(path.join(temp, entry.name, "uploads"));
    }
  }
  return { active, backups, listFailures };
}

/** Caminho relativo no formato em que a app gravava as fotografias:
 *  "ponto-photos/<userId>/<ficheiro>" estilo posix. Tudo o que fuja
 *  disto — absoluto, UNC/rede, "..", barras invertidas — é recusado:
 *  a BD é dados, não autoridade de escrita no disco. */
export function isValidPhotoRel(rel: string): boolean {
  if (rel.includes("\\") || rel.startsWith("/") || DRIVE_PREFIX.test(rel)) {
    return false;
  }
  if (!rel.startsWith(`${PHOTO_SUBDIR}/`)) {
    return false;
  }
  const segments = rel.split("/");
  return !segments.some((s) => s === "" || s === "." || s === "..");
}

interface DeleteOutcome {
  existed: boolean;
  outcome: "gone" | "failed";
}

/** Apaga <base>/<rel> sem nunca sair da base: recusa ligações
 *  simbólicas no caminho que apontem para fora. "gone" cobre tanto o
 *  apagado como o já inexistente — o objetivo de privacidade é o mesmo. */
async function deleteFileWithinBase(
  base: string,
  rel: string
): Promise<DeleteOutcome> {
  const absent: DeleteOutcome = { existed: false, outcome: "gone" };
  const failed: DeleteOutcome = { existed: true, outcome: "failed" };
  const target = path.resolve(base, rel);
  const baseResolved = path.resolve(base);
  if (target !== baseResolved && !target.startsWith(baseResolved + path.sep)) {
    return failed;
  }
  // Symlink no caminho: o realpath do pai tem de ficar dentro da base.
  // Se o pai não existe, o ficheiro também não — já está "gone".
  const realBase = await fs.realpath(baseResolved).catch(() => baseResolved);
  const parentReal = await fs
    .realpath(path.dirname(target))
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        return null;
      }
      return;
    });
  if (parentReal === null) {
    return absent;
  }
  if (parentReal === undefined) {
    return failed;
  }
  if (parentReal !== realBase && !parentReal.startsWith(realBase + path.sep)) {
    // Ligação simbólica a apontar para fora da base — recusado, nunca
    // se apaga fora das pastas conhecidas.
    return failed;
  }
  const stat = await fs.lstat(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      return null;
    }
    return;
  });
  if (stat === null) {
    return absent;
  }
  if (stat === undefined) {
    return failed;
  }
  // O próprio ficheiro ser symlink é seguro: unlink apaga a ligação,
  // nunca o alvo.
  try {
    await fs.rm(target, { recursive: true });
    return { existed: true, outcome: "gone" };
  } catch {
    return failed;
  }
}

/** Uma fotografia, todas as bases: a linha só é apagada quando TODAS
 *  as cópias do ficheiro desaparecem — uma reversão nunca perde o
 *  acesso ao que ainda estiver em disco. */
async function shredOnePhoto(
  client: pg.Client,
  bases: string[],
  row: PhotoRow
): Promise<{
  activeDeleted: number;
  backupDeleted: number;
  failures: string[];
  invalid: boolean;
  rowDeleted: boolean;
}> {
  const result = {
    activeDeleted: 0,
    backupDeleted: 0,
    failures: [] as string[],
    invalid: false,
    rowDeleted: false,
  };
  if (!isValidPhotoRel(row.path)) {
    // Caminho fora do formato — nunca se apaga por ele. A linha fica
    // na BD e o caminho vai para o relatório para revisão manual.
    result.invalid = true;
    return result;
  }
  let allGone = true;
  for (const [index, base] of bases.entries()) {
    const { existed, outcome } = await deleteFileWithinBase(base, row.path);
    if (outcome === "gone") {
      if (!existed) {
        continue;
      }
      if (index === 0) {
        result.activeDeleted += 1;
      } else {
        result.backupDeleted += 1;
      }
    } else {
      allGone = false;
      result.failures.push(path.join(base, row.path));
    }
  }
  if (allGone) {
    await client.query('DELETE FROM "ponto_photos" WHERE id = $1', [row.id]);
    result.rowDeleted = true;
  }
  return result;
}

export const SHRED_REPORT_NAME = "ponto-photo-shred.json";

interface PhotoRow {
  id: string;
  path: string;
}

/** Varredura de órfãos e restos: ficheiros sem linha (o registo que
 *  nunca se concretizou) e as estruturas de pastas vazias. As fotos de
 *  linhas falhadas continuam dentro — se o rm as apagar, a linha é
 *  apagada na próxima corrida; se falhar, já estão registadas. */
async function sweepPhotoDirs(
  bases: string[],
  failures: string[]
): Promise<void> {
  for (const base of bases) {
    const photoRoot = path.join(base, PHOTO_SUBDIR);
    if (!(await isDir(photoRoot))) {
      continue;
    }
    try {
      await fs.rm(photoRoot, { recursive: true });
    } catch {
      if (!failures.includes(photoRoot)) {
        failures.push(photoRoot);
      }
    }
  }
}

/** O relatório fica na pasta de dados da app (UPLOAD_DIR): nas
 *  instalações de serviço Windows é %ProgramData%\OficinaOS\uploads e
 *  no docker é o volume — ambos sobrevivem a atualizações e reversões. */
async function writeShredReport(
  uploadDir: string,
  report: {
    failures: string[];
    invalidPaths: string[];
    pendingPaths: string[];
  }
): Promise<void> {
  const reportPath = path.resolve(uploadDir, SHRED_REPORT_NAME);
  // A pasta de uploads pode ainda não existir numa instalação nova — sem
  // ela a gravação do relatório falhava.
  await fs.mkdir(uploadDir, { recursive: true }).catch(() => undefined);
  // Nunca seguir um symlink/junction pré-existente no caminho do relatório:
  // remove-se a entrada (o rm apaga o link, nunca o alvo) e grava-se com
  // wx — se algo reaparecer entretanto, a escrita falha ruidosamente.
  await fs.rm(reportPath, { force: true }).catch(() => undefined);
  await fs
    .writeFile(
      reportPath,
      JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
      { flag: "wx" }
    )
    .catch(() => undefined);
}

export async function shredPontoPhotos(args: {
  databaseUrl: string;
  uploadDir: string;
}): Promise<{
  backupFilesDeleted: number;
  failures: string[];
  filesDeleted: number;
  invalidRows: number;
  rowsDeleted: number;
  rowsPending: number;
  tableExisted: boolean;
}> {
  const { active, backups, listFailures } = await candidateUploadsBases(
    args.uploadDir
  );
  const bases = [active, ...backups];
  const failures: string[] = [...listFailures];
  const invalidPaths: string[] = [];
  const pendingPaths: string[] = [];

  const client = new pg.Client({ connectionString: args.databaseUrl });
  let rowsDeleted = 0;
  let rowsPending = 0;
  let invalidRows = 0;
  let tableExisted = false;
  let filesDeleted = 0;
  let backupFilesDeleted = 0;
  await client.connect();
  try {
    const exists = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.ponto_photos')::text AS reg"
    );
    tableExisted = Boolean(exists.rows[0]?.reg);
    if (tableExisted) {
      const rows = (
        await client.query<PhotoRow>('SELECT id, path FROM "ponto_photos"')
      ).rows;
      for (const row of rows) {
        const outcome = await shredOnePhoto(client, bases, row);
        filesDeleted += outcome.activeDeleted;
        backupFilesDeleted += outcome.backupDeleted;
        if (outcome.invalid) {
          invalidRows += 1;
          invalidPaths.push(row.path);
        }
        if (outcome.failures.length > 0) {
          failures.push(...outcome.failures);
        }
        if (outcome.rowDeleted) {
          rowsDeleted += 1;
        } else {
          rowsPending += 1;
          pendingPaths.push(row.path);
        }
      }
    }
    // A migração corre uma vez; se a tabela ficar vazia num arranque
    // posterior, é aqui que é removida — senão ficava para sempre como
    // divergência de esquema (vazia mas presente).
    if (tableExisted) {
      const remaining = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM "ponto_photos"'
      );
      if (remaining.rows[0]?.n === 0) {
        await client.query('DROP TABLE "ponto_photos"');
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  await sweepPhotoDirs(bases, failures);
  await writeShredReport(args.uploadDir, {
    failures,
    invalidPaths,
    pendingPaths,
  });

  return {
    backupFilesDeleted,
    failures,
    filesDeleted,
    invalidRows,
    rowsDeleted,
    rowsPending,
    tableExisted,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // Sem BD não há linhas para reconciliar — mas também não há razão
    // para travar o arranque: regista-se e segue-se em frente.
    console.error(
      "[ponto-photo-migration] DATABASE_URL em falta — limpeza das fotos adiada para o próximo arranque"
    );
    return;
  }
  try {
    const result = await shredPontoPhotos({
      databaseUrl,
      uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
    });
    console.log(
      `[ponto-photo-migration] deleted ${result.rowsDeleted} PontoPhoto rows, ${result.filesDeleted} files under the active ${PHOTO_SUBDIR}/ and ${result.backupFilesDeleted} files in updater/installer backup copies (app.prev, oficinaos-keep-*); ${result.rowsPending} rows pending retry`
    );
    // Nunca se falha o arranque por causa disto: as falhas ficam na BD
    // e no relatório, o aviso aparece nas Definições do ponto e a
    // limpeza é retomada no arranque seguinte.
    if (result.rowsPending > 0 || result.failures.length > 0) {
      console.error(
        `[ponto-photo-migration] ${result.rowsPending} photos could not be fully removed — the app retries on next start; see Settings for manual cleanup`
      );
    }
  } catch (err) {
    console.error(
      `[ponto-photo-migration] cleanup error (non-fatal, retries on next start): ${(err as Error).message}`
    );
  }
}

const invokedAsMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error(
      `[ponto-photo-migration] unexpected error (non-fatal): ${(err as Error).message}`
    );
  });
}
