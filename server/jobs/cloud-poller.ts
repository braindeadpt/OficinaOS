import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { syncCloudEntitlements } from "../services/cloud.service.js";
import {
  pontoConfigPushFailed,
  pushPontoCloudConfig,
} from "../services/ponto/config-sync.js";
import { purgeExpiredWhatsAppLocalToken } from "../services/whatsapp-local-sunset.service.js";
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
      // Sunset Meta local — a limpeza é local e independente do pairing da
      // Cloud. Falha aqui não pode adiar o sync de entitlements; o próximo
      // tick volta a tentar de forma idempotente.
      try {
        await purgeExpiredWhatsAppLocalToken(app.prisma);
      } catch (err) {
        app.log.warn({ err }, "whatsapp local token purge failed");
      }
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
      const pontoFresh = status.modules.includes("ponto");
      // Além da transição para entitlement fresco, repetir o push quando a
      // última tentativa falhou — sem isto, uma falha de rede no arranque
      // deixava a sonda desligada até ao arranque seguinte.
      if (
        (!hadFreshPonto && pontoFresh) ||
        (pontoFresh && pontoConfigPushFailed())
      ) {
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
