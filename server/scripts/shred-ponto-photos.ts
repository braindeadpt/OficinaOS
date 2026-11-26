/**
 * Migração de privacidade do livro de ponto: apaga todos os ficheiros em
 * UPLOAD_DIR/ponto-photos e as linhas legadas de ponto_photos antes de o
 * `prisma migrate deploy` remover a tabela. Corre como parte de
 * `bun run db:migrate-deploy`; é idempotente e falha fechado — se a
 * eliminação falhar, a migração não avança.
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

export async function shredPontoPhotos(args: {
  databaseUrl: string;
  uploadDir: string;
}): Promise<{
  filesDeleted: number;
  rowsDeleted: number;
  tableExisted: boolean;
}> {
  const dir = path.resolve(args.uploadDir, PHOTO_SUBDIR);
  const filesDeleted = await countPhotoFiles(dir);
  await fs.rm(dir, { force: true, recursive: true });

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
  return { filesDeleted, rowsDeleted, tableExisted };
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
    `[ponto-photo-migration] deleted ${result.rowsDeleted} PontoPhoto rows and ${result.filesDeleted} files under ${PHOTO_SUBDIR}/`
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
