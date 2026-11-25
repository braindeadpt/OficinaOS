import type { FastifyInstance } from "fastify";
import { processPontoReminders } from "../services/ponto/reminder.js";

const INTERVAL_MS = 15 * 60 * 1000;

// Um tick de cada vez — o trabalho por tick é curto mas um envio lento
// não pode sobrepor-se ao seguinte (duplicaria presumidas/lembretes).
let tickRunning = false;

/** Livro de ponto — lembrete de saída (Esquecimentos), lembrete de
 *  pausa e alerta ao gestor por saída presumida por validar. Corre a
 *  cada 15 min; o trabalho real está em services/ponto/reminder.ts. */
export function startPontoReminderScheduler(app: FastifyInstance): () => void {
  const tick = async (): Promise<void> => {
    if (tickRunning) {
      return;
    }
    tickRunning = true;
    try {
      await processPontoReminders(app.prisma, app.log, app.wsBroadcast);
    } catch (err) {
      app.log.warn({ err }, "ponto reminder scheduler tick failed");
    } finally {
      tickRunning = false;
    }
  };

  const handle = setInterval(tick, INTERVAL_MS);
  tick().catch((err) =>
    app.log.warn({ err }, "ponto reminder scheduler initial tick failed")
  );

  return () => {
    clearInterval(handle);
  };
}
