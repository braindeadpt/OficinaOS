import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { syncSmsInbound } from "../services/sms-cloud.service.js";
import { pollWhatsAppInbound } from "../services/whatsapp-bot.service.js";

const INTERVAL_MS = 12_000;

/**
 * Poll rápido das filas de mensagens Pro (SMS + WhatsApp) — 12 s em
 * vez dos ~2 min do ciclo de entitlements, porque resposta a cliente
 * é sensível a latência. Só corre quando a loja está emparelhada e o
 * módulo consta dos entitlements em cache; o resto da sincronização
 * (registos, credenciais, outros módulos) fica no cloud-poller.
 */
export function startMessagingPoller(app: FastifyInstance): () => void {
  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) {
      return;
    }
    ticking = true;
    try {
      const settings = await getOrCreateShopSettings(app.prisma);
      const modules = Array.isArray(settings.cloudEntitlements)
        ? (settings.cloudEntitlements as string[])
        : [];
      if (
        !(
          settings.cloudApiUrl &&
          settings.cloudShopTokenEncrypted &&
          (modules.includes("sms") || modules.includes("whatsapp-bot"))
        )
      ) {
        return;
      }
      const token = decryptSecret(settings.cloudShopTokenEncrypted);
      const notifyCtx = { prisma: app.prisma, wsBroadcast: app.wsBroadcast };
      if (modules.includes("whatsapp-bot")) {
        await pollWhatsAppInbound(
          app.prisma,
          settings.cloudApiUrl,
          token,
          app.log,
          notifyCtx,
          modules
        );
      }
      if (modules.includes("sms")) {
        await syncSmsInbound(
          app.prisma,
          settings.cloudApiUrl,
          token,
          app.log,
          notifyCtx,
          modules
        );
      }
    } catch (err) {
      app.log.warn({ err }, "messaging poller tick failed");
    } finally {
      ticking = false;
    }
  };

  const handle = setInterval(tick, INTERVAL_MS);
  if (handle.unref) {
    handle.unref();
  }
  return () => {
    clearInterval(handle);
  };
}
