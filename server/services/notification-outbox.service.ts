import { OutboxStatus } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import { decryptSecret } from "../lib/crypto.js";
import { findCustomerByPhone } from "../repositories/customer.repository.js";
import {
  createOutboxEntry,
  findManyOutboxEntries,
  findNotificationTemplateUnique,
  findOutboxEntryById,
  transitionOutboxEntry,
} from "../repositories/notification.repository.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";
import { renderTemplate } from "./notification-renderer.js";
import { formatPhone } from "./notification-sender.js";
import { decryptSmsConfig, type SendResult, sendSms } from "./sms.service.js";
import { type CloudCredentials, sendSmsViaCloud } from "./sms-cloud.service.js";
import {
  resolveWhatsAppChannel,
  sendWhatsAppText,
  type WhatsAppChannel,
} from "./whatsapp-channel.js";

/**
 * Events a staff member fires by hand for a specific customer — not
 * automated messaging. The signature link is the same action the staff
 * would take by copying it into the shop's own WhatsApp: the customer is
 * waiting for it, it is sent once per click and it expires with the
 * session. These still respect the channel toggles and provider config;
 * they skip only the opt-in consent flag, which exists to gate automated
 * notifications, not staff-initiated service messages.
 */
export const STAFF_INITIATED_TEMPLATES: ReadonlySet<string> = new Set([
  "signature_link",
]);

/**
 * WhatsApp consent gate. Only customers who opted in may receive messages;
 * the shop's own phone is always allowed (test notifications, shop contact).
 * Returns null when the send must be skipped, with a human-readable reason.
 */
export async function assertWhatsAppConsent(
  prisma: DbClient,
  phone: string,
  shopPhone: string | null
): Promise<string | null> {
  if (shopPhone && phone.trim() === shopPhone.trim()) {
    return null; // shop's own number — test notifications and replies
  }
  const customer = await findCustomerByPhone(prisma, phone);
  if (!customer) {
    return "no customer record for this phone";
  }
  if (!customer.whatsappConsent) {
    return "customer has not granted WhatsApp consent";
  }
  return null;
}

interface OutboxEntry {
  channel: string;
  createdAt: Date;
  deliverBy: Date | null;
  error: string | null;
  id: string;
  jobId: string | null;
  nextRetryAt: Date | null;
  recipientPhone: string;
  renderedBody: string;
  retryCount: number | null;
  status: OutboxStatus;
  templateName: string;
}

const POLL_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;
const BACKOFF_MS = [60_000, 300_000, 900_000];
// A status notification sent a day late is worse than none — stale
// entries are cancelled instead of delivered (e.g. after the channel
// was re-enabled following days of downtime).
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;
let intervalRef: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

export async function queueNotification(
  prisma: DbClient,
  data: {
    deliverBy?: Date;
    jobId?: string;
    templateName: string;
    channel: "WHATSAPP" | "SMS";
    recipientPhone: string;
    templateVars: Record<string, string>;
    templateBody: string;
  }
): Promise<void> {
  const renderedBody = renderTemplate(data.templateBody, data.templateVars);
  await createOutboxEntry(prisma, {
    channel: data.channel,
    deliverBy: data.deliverBy ?? null,
    job: data.jobId ? { connect: { id: data.jobId } } : undefined,
    recipientPhone: data.recipientPhone,
    renderedBody,
    status: OutboxStatus.QUEUED,
    templateName: data.templateName,
  });
}

async function handleRetry(
  prisma: DbClient,
  entryId: string,
  currentRetries: number,
  errorMessage: string
): Promise<void> {
  if (currentRetries < MAX_RETRIES) {
    const nextRetry = new Date(
      Date.now() + BACKOFF_MS[Math.min(currentRetries, BACKOFF_MS.length - 1)]
    );
    // Guarded on QUEUED — a concurrent cancel must not be resurrected.
    await transitionOutboxEntry(prisma, entryId, OutboxStatus.QUEUED, {
      error: errorMessage,
      nextRetryAt: nextRetry,
      retryCount: currentRetries + 1,
      status: OutboxStatus.QUEUED,
    });
  } else {
    await transitionOutboxEntry(prisma, entryId, OutboxStatus.QUEUED, {
      error: errorMessage,
      nextRetryAt: null,
      status: OutboxStatus.FAILED,
    });
  }
}

async function markSent(prisma: DbClient, entryId: string): Promise<void> {
  try {
    // Guarded on QUEUED — if the entry was cancelled while the send
    // was in flight, CANCELLED wins over SENT.
    await transitionOutboxEntry(prisma, entryId, OutboxStatus.QUEUED, {
      error: null,
      sentAt: new Date(),
      status: OutboxStatus.SENT,
    });
  } catch (dbErr) {
    logger.error(
      { err: dbErr, entryId },
      "Outbox: failed to mark entry as SENT after successful send"
    );
  }
}

/**
 * Cancels an outbox entry that sat QUEUED past its useful life — a
 * status update sent days late is worse than none. Returns true when
 * the entry was cancelled (caller must skip sending).
 */
async function cancelIfExpired(
  prisma: DbClient,
  entry: OutboxEntry
): Promise<boolean> {
  // A payload with its own deadline (a signing link whose session expires
  // in minutes) dies at deliverBy — the generic 24h cutoff is far too late
  // for it, and a retry landing after expiry would send a dead link.
  if (entry.deliverBy && entry.deliverBy.getTime() <= Date.now()) {
    await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
      error: "Expired: delivery deadline passed",
      status: OutboxStatus.CANCELLED,
    });
    return true;
  }
  if (
    entry.createdAt &&
    Date.now() - entry.createdAt.getTime() > MAX_ENTRY_AGE_MS
  ) {
    await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
      error: "Expired: queued for more than 24h",
      status: OutboxStatus.CANCELLED,
    });
    return true;
  }
  return false;
}

/**
 * Cancels an outbox entry blocked by the consent gate, recording why.
 * Returns true when the entry was blocked (caller must skip sending).
 */
async function cancelIfConsentMissing(
  prisma: DbClient,
  entry: OutboxEntry,
  shopPhone: string | null
): Promise<boolean> {
  if (STAFF_INITIATED_TEMPLATES.has(entry.templateName)) {
    return false;
  }
  const consentError = await assertWhatsAppConsent(
    prisma,
    entry.recipientPhone,
    shopPhone
  );
  if (!consentError) {
    return false;
  }
  await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
    error: `Blocked: ${consentError}`,
    status: OutboxStatus.CANCELLED,
  });
  return true;
}

async function processWhatsAppEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  channel: WhatsAppChannel,
  countryCode: string,
  shopPhone: string | null,
  settings: ShopSettingsRow | null
): Promise<void> {
  if (await cancelIfExpired(prisma, entry)) {
    return;
  }
  // Consent is the law here: without it the entry is cancelled (not
  // retried) and the reason lands in the outbox error column.
  const blocked = await cancelIfConsentMissing(prisma, entry, shopPhone);
  if (blocked) {
    return;
  }
  const result = await sendWhatsAppText(
    prisma,
    channel,
    entry.recipientPhone,
    entry.renderedBody,
    countryCode,
    settings
  );
  if (result.success) {
    await markSent(prisma, entry.id);
    return;
  }
  try {
    await handleRetry(
      prisma,
      entry.id,
      entry.retryCount ?? 0,
      result.error ?? "Unknown error"
    );
  } catch (retryDbErr) {
    logger.error(
      { err: retryDbErr, entryId: entry.id },
      "Outbox: failed to update retry state after failed send"
    );
  }
}

async function processSmsEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  channels: SmsChannels,
  countryCode: string,
  shopPhone: string | null
): Promise<void> {
  if (await cancelIfExpired(prisma, entry)) {
    return;
  }
  const blocked = await cancelIfConsentMissing(prisma, entry, shopPhone);
  if (blocked) {
    return;
  }
  // Pro: envia pela Cloud (device da loja ou pool) — o id do outbox é o
  // dedupeId para a Cloud não repetir um envio já aceite. Se a Cloud
  // falhar, o gateway LAN (se configurado) é o fallback; relatórios de
  // entrega voltam como REPORT na fila inbound.
  let result: SendResult | null = null;
  if (channels.cloud) {
    const jobCode = entry.jobId
      ? (
          await prisma.job.findUnique({
            select: { jobCode: true },
            where: { id: entry.jobId },
          })
        )?.jobCode
      : undefined;
    result = await sendSmsViaCloud(channels.cloud, {
      dedupeId: entry.id,
      jobCode,
      text: entry.renderedBody,
      to: formatPhone(entry.recipientPhone, countryCode),
    }).catch((err) => ({
      error: err instanceof Error ? err.message : "CLOUD_UNREACHABLE",
      success: false,
    }));
  }
  if (!result?.success && channels.local) {
    result = await sendSms(
      channels.local,
      entry.recipientPhone,
      entry.renderedBody,
      countryCode
    );
  }
  result ??= { error: "SMS channel unavailable", success: false };
  if (result.success) {
    await markSent(prisma, entry.id);
    return;
  }
  try {
    await handleRetry(
      prisma,
      entry.id,
      entry.retryCount ?? 0,
      result.error ?? "Unknown error"
    );
  } catch (retryDbErr) {
    logger.error(
      { err: retryDbErr, entryId: entry.id },
      "Outbox: failed to update retry state after failed send"
    );
  }
}

interface SmsChannels {
  /** Credenciais cloud — só preenchidas com o entitlement "sms" ativo. */
  cloud: CloudCredentials | null;
  local: { password: string; url: string; user: string } | null;
}

interface ChannelConfigs {
  sms: SmsChannels | null;
  whatsapp: WhatsAppChannel | null;
}

async function processEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  configs: ChannelConfigs,
  countryCode: string,
  shopPhone: string | null,
  shopSettings: ShopSettingsRow | null
): Promise<void> {
  try {
    if (entry.channel === "WHATSAPP" && configs.whatsapp) {
      await processWhatsAppEntry(
        prisma,
        entry,
        configs.whatsapp,
        countryCode,
        shopPhone,
        shopSettings
      );
    } else if (entry.channel === "SMS" && configs.sms) {
      await processSmsEntry(prisma, entry, configs.sms, countryCode, shopPhone);
    } else if (entry.channel === "WHATSAPP" || entry.channel === "SMS") {
      // Channel not configured — cancel now. Leaving it QUEUED would
      // re-select it on every 5s poll and starve the batch of 10.
      await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
        error: `Channel ${entry.channel} is not configured`,
        status: OutboxStatus.CANCELLED,
      });
      return;
    } else {
      logger.warn(
        `Outbox: unexpected channel "${entry.channel}" for entry ${entry.id} — marking FAILED`
      );
      try {
        await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
          error: `Unsupported channel: ${entry.channel}`,
          status: OutboxStatus.FAILED,
        });
      } catch (dbErr) {
        logger.error(
          { err: dbErr, entryId: entry.id },
          "Outbox: failed to mark unsupported channel entry as FAILED"
        );
      }
    }
  } catch (err) {
    logger.warn({ err, entryId: entry.id }, "Outbox: failed to process entry");
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await handleRetry(prisma, entry.id, entry.retryCount ?? 0, msg);
    } catch (retryErr) {
      logger.error(
        { err: retryErr, entryId: entry.id },
        "Outbox: failed to handle retry"
      );
    }
  }
}

export async function processOutbox(prisma: DbClient): Promise<void> {
  if (isProcessing) {
    return;
  }
  isProcessing = true;
  try {
    const pending = await findManyOutboxEntries(
      prisma,
      {
        status: OutboxStatus.QUEUED,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      { createdAt: "asc" },
      10
    );

    if (pending.length === 0) {
      return;
    }

    const shopSettings = await findShopSettingsUnique(prisma);
    const configs: ChannelConfigs = {
      sms: getSmsConfig(shopSettings),
      whatsapp: shopSettings ? resolveWhatsAppChannel(shopSettings) : null,
    };
    if (!(configs.whatsapp || configs.sms)) {
      return;
    }
    const countryCode = shopSettings?.countryCode ?? "PT";

    for (const entry of pending) {
      await processEntry(
        prisma,
        entry,
        configs,
        countryCode,
        shopSettings?.phone ?? null,
        shopSettings
      );
    }
  } finally {
    isProcessing = false;
  }
}

export function startOutboxWorker(prisma: DbClient): () => void {
  intervalRef = setInterval(() => {
    processOutbox(prisma).catch((err) => {
      logger.error("Outbox worker error:", err);
    });
  }, POLL_INTERVAL_MS);
  if (intervalRef.unref) {
    intervalRef.unref();
  }
  return () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = null;
    }
  };
}

type ShopSettingsRow = NonNullable<
  Awaited<ReturnType<typeof findShopSettingsUnique>>
>;

function getSmsConfig(row: ShopSettingsRow | null): SmsChannels | null {
  // Grátis = gateway LAN; Pro (entitlement "sms") = envio pela Cloud
  // com fallback para o LAN quando este também está configurado.
  const modules = Array.isArray(row?.cloudEntitlements)
    ? (row?.cloudEntitlements as string[])
    : [];
  const cloud =
    modules.includes("sms") && row?.cloudApiUrl && row?.cloudShopTokenEncrypted
      ? {
          apiUrl: row.cloudApiUrl,
          token: decryptSecret(row.cloudShopTokenEncrypted),
        }
      : null;
  const local = row?.smsEnabled
    ? decryptSmsConfig({
        gatewayPasswordEncrypted: row.smsGatewayPasswordEncrypted,
        gatewayUrl: row.smsGatewayUrl,
        gatewayUser: row.smsGatewayUser,
      })
    : null;
  if (!(cloud || local)) {
    return null;
  }
  return { cloud, local };
}

export async function getOutboxLogs(
  prisma: DbClient,
  limit = 50
): Promise<OutboxEntry[]> {
  const entries = await findManyOutboxEntries(
    prisma,
    {},
    { createdAt: "desc" },
    limit
  );
  return entries.map((e) => ({
    channel: e.channel,
    createdAt: e.createdAt,
    deliverBy: e.deliverBy,
    error: e.error,
    id: e.id,
    jobId: e.jobId,
    nextRetryAt: e.nextRetryAt,
    renderedBody: e.renderedBody,
    recipientPhone: e.recipientPhone,
    retryCount: e.retryCount,
    status: e.status,
    templateName: e.templateName,
  }));
}

export async function cancelOutboxEntry(prisma: DbClient, id: string) {
  const entry = await findOutboxEntryById(prisma, id);
  if (!entry) {
    throw new AppError("NOT_FOUND");
  }
  if (entry.status !== OutboxStatus.QUEUED) {
    throw new AppError("OUTBOX_NOT_QUEUED");
  }
  // Conditional transition — a worker may flip the entry between the
  // read above and this write; only cancel while still QUEUED.
  const count = await transitionOutboxEntry(prisma, id, OutboxStatus.QUEUED, {
    status: OutboxStatus.CANCELLED,
  });
  if (count === 0) {
    throw new AppError("OUTBOX_NOT_QUEUED");
  }
  return { id, status: OutboxStatus.CANCELLED };
}

export async function testNotification(prisma: DbClient, templateId: string) {
  const template = await findNotificationTemplateUnique(prisma, templateId);
  if (!template) {
    throw new AppError("TEMPLATE_NOT_FOUND");
  }
  if (template.channel !== "WHATSAPP" && template.channel !== "SMS") {
    throw new AppError("TEMPLATE_NOT_FOUND");
  }
  const shop = await findShopSettingsUnique(prisma);
  const phone = shop?.phone;
  if (!phone) {
    throw new AppError("NO_SHOP_PHONE");
  }
  await queueNotification(prisma, {
    channel: template.channel,
    recipientPhone: phone,
    templateBody: template.body,
    templateName: template.name,
    templateVars: {
      customerName: "Test",
      jobCode: "TEST-001",
      shopName: shop?.shopName ?? "OficinaOS",
    },
  });
}
