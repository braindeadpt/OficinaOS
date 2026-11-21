import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { syncCloudEntitlements } from "../services/cloud.service.js";

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
      await syncCloudEntitlements(app.prisma, app.log, {
        prisma: app.prisma,
        wsBroadcast: app.wsBroadcast,
      });
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
