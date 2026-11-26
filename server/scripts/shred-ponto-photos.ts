/**
 * Migração de privacidade do livro de ponto: apaga todos os ficheiros em
 * UPLOAD_DIR/ponto-photos e as linhas legadas de ponto_photos antes de o
 * `prisma migrate deploy` remover a tabela. Corre como parte de
 * `bun run db:migrate-deploy`; é idempotente e falha fechado — se a
 * eliminação falhar, a migração não avança.
 *
 * A limpeza cobre TODAS as cópias que o atualizador/instalador podem
 * reter, porque a decisão do dono é "nada fica connosco":
 * - a pasta ativa <app>/uploads/ponto-photos;
 * - as instalações anteriores preservadas para rollback pelo
 *   update-apply.ps1 — <root>/app.prev…/uploads/ponto-photos (portátil e
 *   instalado usam o mesmo nome);
 * - as cópias temporárias %TEMP%/oficinaos-keep-…/uploads/ponto-photos,
 *   que sobrevivem se uma atualização for interrompida a meio.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const PHOTO_SUBDIR = "ponto-photos";

async function countPhotoFiles(root: string): Promise<number> {
  const stat = await fs.lstat(root).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  if (!stat) {
    return 0;
  }
  // Symlinks contam como um item apagado e nunca são seguidos.
  if (!stat.isDirectory()) {
    return 1;
  }
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    total += entry.isDirectory() ? await countPhotoFiles(full) : 1;
  }
  return total;
}

async function isDir(root: string): Promise<boolean> {
  const stat = await fs.lstat(root).catch(() => null);
  return stat?.isDirectory() === true;
}

/**
 * Todas as pastas de fotografias conhecidas: a ativa mais as cópias de
 * backup criadas pelo atualizador/instalador. A derivação do layout
 * portátil só acontece quando uploadDir é mesmo <root>/app/uploads —
 * um UPLOAD_DIR personalizado noutro sítio não leva a varrer pastas
 * alheias.
 */
export async function candidatePhotoDirs(uploadDir: string): Promise<{
  active: string;
  backups: string[];
}> {
  const active = path.resolve(uploadDir, PHOTO_SUBDIR);
  const backups: string[] = [];
  const resolvedUpload = path.resolve(uploadDir);
  const appDir = path.dirname(resolvedUpload);
  if (
    path.basename(resolvedUpload) === "uploads" &&
    path.basename(appDir) === "app"
  ) {
    const installRoot = path.dirname(appDir);
    for (const entry of await fs
      .readdir(installRoot, { withFileTypes: true })
      .catch(() => [])) {
      // O update-apply.ps1 usa exatamente "app.prev"; o prefixo cobre
      // variantes futuras (app.prev.1, app.prev-old) sem tocar em pastas
      // alheias como "app" ou "approvals".
      if (!(entry.isDirectory() && entry.name.startsWith("app.prev"))) {
        continue;
      }
      backups.push(path.join(installRoot, entry.name, "uploads", PHOTO_SUBDIR));
    }
  }
  const temp = process.env.TEMP ?? process.env.TMP;
  if (temp && (await isDir(temp))) {
    for (const entry of await fs
      .readdir(temp, { withFileTypes: true })
      .catch(() => [])) {
      if (!(entry.isDirectory() && entry.name.startsWith("oficinaos-keep-"))) {
        continue;
      }
      backups.push(path.join(temp, entry.name, "uploads", PHOTO_SUBDIR));
    }
  }
  return { active, backups };
}

export async function shredPontoPhotos(args: {
  databaseUrl: string;
  uploadDir: string;
}): Promise<{
  backupFilesDeleted: number;
  filesDeleted: number;
  rowsDeleted: number;
  tableExisted: boolean;
}> {
  const { active, backups } = await candidatePhotoDirs(args.uploadDir);
  let filesDeleted = 0;
  let backupFilesDeleted = 0;
  for (const dir of [active, ...backups]) {
    const count = await countPhotoFiles(dir);
    await fs.rm(dir, { force: true, recursive: true });
    if (dir === active) {
      filesDeleted += count;
    } else {
      backupFilesDeleted += count;
    }
  }

  const client = new pg.Client({ connectionString: args.databaseUrl });
  let rowsDeleted = 0;
  let tableExisted = false;
  await client.connect();
  try {
    const exists = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.ponto_photos')::text AS reg"
    );
    tableExisted = Boolean(exists.rows[0]?.reg);
    if (tableExisted) {
      const res = await client.query('DELETE FROM "ponto_photos"');
      rowsDeleted = res.rowCount ?? 0;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  return { backupFilesDeleted, filesDeleted, rowsDeleted, tableExisted };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL em falta — migração das fotos do ponto abortada"
    );
  }
  const result = await shredPontoPhotos({
    databaseUrl,
    uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  });
  console.log(
    `[ponto-photo-migration] deleted ${result.rowsDeleted} PontoPhoto rows, ${result.filesDeleted} files under the active ${PHOTO_SUBDIR}/ and ${result.backupFilesDeleted} files in updater/installer backup copies (app.prev, oficinaos-keep-*)`
  );
}

const invokedAsMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error(
      `[ponto-photo-migration] failed; migration stopped: ${(err as Error).message}`
    );
    process.exitCode = 1;
  });
}
