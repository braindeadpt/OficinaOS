import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { syncCloudEntitlements } from "../services/cloud.service.js";
import { pushPontoCloudConfig } from "../services/ponto/config-sync.js";
import { isModuleEnabled } from "../utils/modules.js";

const INTERVAL_MS = 2 * 60 * 1000;

/**
 * Keeps the cloud pairing fresh (entitlements) and pulls customer
 * diagnostics pushed to the shop's public code (diag-intake module).
 * Cheap no-op when unpaired — syncCloudEntitlements throws
 * CLOUD_NOT_PAIRED before any network call.
 */
export function startCloudPoller(app: FastifyInstance): () => void {
  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) {
      return; // ciclo anterior ainda corre — não sobrepor ticks
    }
    ticking = true;
    try {
      const before = await app.prisma.shopSettings.findUnique({
        where: { id: "default" },
      });
      const hadFreshPonto = isModuleEnabled(before, "ponto");
      const status = await syncCloudEntitlements(app.prisma, app.log, {
        prisma: app.prisma,
        wsBroadcast: app.wsBroadcast,
      });
      // Se o cache tinha expirado (ou o módulo acabou de ser ativado), o
      // arranque já passou: este é o momento em que recuperamos o sync sem
      // voltar a transmitir staff a cada tick — só na transição para um
      // entitlement fresco de ponto.
      if (!hadFreshPonto && status.modules.includes("ponto")) {
        pushPontoCloudConfig(app.prisma, app.log).catch((err) =>
          app.log.warn({ err }, "ponto config sync após refresh cloud falhou")
        );
      }
    } catch (err) {
      // Expected when unpaired or when the cloud is down — stay quiet.
      if (!(err instanceof AppError)) {
        app.log.error(err, "cloud poller tick failed");
      }
    } finally {
      ticking = false;
    }
  };

  const handle = setInterval(tick, INTERVAL_MS);

  return () => {
    clearInterval(handle);
  };
}
