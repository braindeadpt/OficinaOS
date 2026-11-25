import type { FastifyInstance } from "fastify";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Livro de ponto — purga da retenção legal (5 anos), 1×/dia e no
 *  arranque. Não se faz SET ROLE: ponto_purge_expired() é SECURITY
 *  DEFINER e pertence ao papel NOLOGIN oficinaos_ponto_purge; basta o
 *  papel operacional ter EXECUTE para o Postgres a correr já como o
 *  papel correto. Se os grants/ownership faltarem a chamada falha e o
 *  livro continua fechado — o provisioning do arranque repõe-nos. */
export function startPontoPurgeScheduler(app: FastifyInstance): () => void {
  let tickRunning = false;
  const tick = async (): Promise<void> => {
    if (tickRunning) {
      return;
    }
    tickRunning = true;
    try {
      await app.prisma.$queryRaw`SELECT ponto_purge_expired()`;
    } catch (err) {
      app.log.warn({ err }, "ponto purge scheduler tick failed");
    } finally {
      tickRunning = false;
    }
  };

  const handle = setInterval(tick, INTERVAL_MS);
  if (handle.unref) {
    handle.unref();
  }
  tick().catch((err) =>
    app.log.warn({ err }, "ponto purge scheduler initial tick failed")
  );

  return () => {
    clearInterval(handle);
  };
}
