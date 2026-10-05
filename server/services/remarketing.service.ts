import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import {
  decryptWhatsAppConfig,
  sendWhatsAppTemplate,
} from "./notification-sender.js";

/**
 * Remarketing automático (módulo Pro "remarketing"): uma sweep por hora
 * encontra clientes com consentimento WhatsApp cuja última reparação
 * entregue já passou `remarketingDays` e envia-lhes uma mensagem de
 * re-engagement. Como é iniciada pela loja (fora da janela de 24h do
 * cliente), a mensagem sai como Meta `type:"template"` — a loja tem de
 * criar/aprovar o template na sua conta Meta Business e configurar o
 * nome em Definições → WhatsApp.
 *
 * Anti-spam: máximo BATCH_LIMIT envios por sweep e cada cliente só é
 * recontactado a cada `remarketingCooldownDays` (medido a partir de
 * lastRemarketingAt — marcado na tentativa para um erro de config Meta
 * não retentar de hora a hora).
 */

const MODULE = "remarketing";
const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 10;
const TEMPLATE_LANG = "pt";
const WHITESPACE_RE = /\s+/;

interface EligibleCustomer {
  id: string;
  name: string;
  phone: string;
}

export async function runRemarketingSweep(
  prisma: DbClient,
  log: FastifyBaseLogger
): Promise<number> {
  const settings = await findShopSettingsUnique(prisma);
  if (
    !(
      settings?.remarketingEnabled &&
      settings.whatsappEnabled &&
      settings.remarketingTemplate &&
      settings.whatsappApiTokenEncrypted &&
      settings.whatsappBusinessId &&
      settings.whatsappPhoneNumberId
    )
  ) {
    return 0;
  }
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[])
    : [];
  if (!modules.includes(MODULE)) {
    return 0;
  }
  const config = decryptWhatsAppConfig({
    apiTokenEncrypted: settings.whatsappApiTokenEncrypted,
    businessId: settings.whatsappBusinessId,
    phoneNumberId: settings.whatsappPhoneNumberId,
  });
  if (!config) {
    return 0;
  }

  const customers = await prisma.$queryRaw<EligibleCustomer[]>`
    SELECT c.id, c.name, c.phone
    FROM customers c
    WHERE c."whatsappConsent" = true
      AND (c."lastRemarketingAt" IS NULL
           OR c."lastRemarketingAt" < now() - interval '1 day' * ${settings.remarketingCooldownDays})
      AND EXISTS (
        SELECT 1 FROM jobs j
        WHERE j."customerId" = c.id AND j.status = 'DELIVERED'
      )
      AND (
        SELECT MAX(j."updatedAt") FROM jobs j
        WHERE j."customerId" = c.id AND j.status = 'DELIVERED'
      ) < now() - interval '1 day' * ${settings.remarketingDays}
    ORDER BY c."createdAt" ASC
    LIMIT ${BATCH_LIMIT}
  `;

  const shopName = settings.shopName || "a nossa loja";
  let sent = 0;
  for (const customer of customers) {
    const firstName =
      customer.name.trim().split(WHITESPACE_RE)[0] || customer.name;
    const result = await sendWhatsAppTemplate(
      config,
      customer.phone,
      settings.remarketingTemplate,
      TEMPLATE_LANG,
      [firstName, shopName],
      settings.countryCode ?? "PT"
    );
    // Marked on attempt: a broken template name or a Meta outage must not
    // retry the same customer every hour for the whole cooldown window.
    await prisma.customer.update({
      where: { id: customer.id },
      data: { lastRemarketingAt: new Date() },
    });
    if (result.success) {
      sent += 1;
    } else {
      log.warn(
        { customerId: customer.id, error: result.error },
        "remarketing send failed"
      );
    }
  }
  return sent;
}

export function startRemarketingScheduler(app: FastifyInstance): () => void {
  const sweep = async (): Promise<void> => {
    try {
      const sent = await runRemarketingSweep(app.prisma, app.log);
      if (sent > 0) {
        app.log.info({ sent }, "remarketing sweep sent messages");
      }
    } catch (err) {
      app.log.error({ err }, "remarketing sweep failed");
    }
  };

  const handle = setInterval(sweep, INTERVAL_MS);
  if (handle.unref) {
    handle.unref();
  }
  // First sweep shortly after boot, not blocking startup.
  const initial = setTimeout(sweep, 90_000);
  if (initial.unref) {
    initial.unref();
  }

  return () => {
    clearInterval(handle);
    clearTimeout(initial);
  };
}
