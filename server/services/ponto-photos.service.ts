import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/env.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";

/**
 * Fotos de prova do livro de ponto (RGPD/plano §5): apagadas aos 90 dias —
 * o registo TimeEntry fica, com a referência de foto morta (a rota de
 * serve devolve 404 e o painel mostra "foto expirada"). Corre ao mesmo
 * cadenciador dos outros cleanups (server/index.ts runCleanup).
 */
const RETENTION_DAYS = 90;

export async function cleanupPontoPhotos(prisma: DbClient) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const old = await prisma.pontoPhoto.findMany({
    select: { id: true, path: true },
    where: { createdAt: { lt: cutoff } },
  });
  if (old.length === 0) {
    return 0;
  }

  await prisma.pontoPhoto.deleteMany({
    where: { id: { in: old.map((p) => p.id) } },
  });

  const base = path.resolve(loadEnv().UPLOAD_DIR);
  for (const photo of old) {
    const full = path.resolve(base, photo.path);
    if (full !== base && full.startsWith(base + path.sep)) {
      await fs.unlink(full).catch(() => undefined);
    }
  }

  logger.info(
    `[cleanup] Deleted ${old.length} ponto photos older than ${RETENTION_DAYS} days`
  );
  return old.length;
}
