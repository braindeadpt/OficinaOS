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
 *
 * Ordem: ficheiro primeiro, linha depois. Apagar a linha primeiro perdia
 * a única referência que a purga usa — um `unlink` falhado deixava o
 * ficheiro órfão para sempre. ENOENT conta como sucesso (a interrupção
 * entre os dois passos é recuperável); qualquer outra falha mantém a
 * linha para a ronda seguinte.
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

  const base = path.resolve(loadEnv().UPLOAD_DIR);
  let removed = 0;
  for (const photo of old) {
    const full = path.resolve(base, photo.path);
    if (full === base || !full.startsWith(base + path.sep)) {
      logger.warn(
        `[cleanup] ponto photo ${photo.id}: path fora do UPLOAD_DIR — linha mantida`
      );
      continue;
    }
    try {
      await fs.unlink(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn(
          `[cleanup] ponto photo ${photo.id}: unlink falhou (${(err as Error).message}) — linha mantida para a próxima ronda`
        );
        continue;
      }
    }
    await prisma.pontoPhoto.delete({ where: { id: photo.id } });
    removed += 1;
  }

  if (removed > 0) {
    logger.info(
      `[cleanup] Deleted ${removed} ponto photos older than ${RETENTION_DAYS} days`
    );
  }
  return removed;
}
