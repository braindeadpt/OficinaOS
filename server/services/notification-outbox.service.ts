import { OutboxStatus } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import { findCustomerByPhone } from "../repositories/customer.repository.js";
import {
  createOutboxEntry,
  findManyOutboxEntries,
  findNotificationTemplateUnique,
  findOutboxEntryById,
  updateOutboxEntry,
} from "../repositories/notification.repository.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";
import { renderTemplate } from "./notification-renderer.js";
import { decryptWhatsAppConfig, sendWhatsApp } from "./notification-sender.js";

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
let intervalRef: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

export async function queueNotification(
  prisma: DbClient,
  data: {
    jobId?: string;
    templateName: string;
    channel: "WHATSAPP";
    recipientPhone: string;
    templateVars: Record<string, string>;
    templateBody: string;
  }
): Promise<void> {
  const renderedBody = renderTemplate(data.templateBody, data.templateVars);
  await createOutboxEntry(prisma, {
    channel: data.channel,
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
    await updateOutboxEntry(
      prisma,
      { id: entryId },
      {
        error: errorMessage,
        nextRetryAt: nextRetry,
        retryCount: currentRetries + 1,
        status: OutboxStatus.QUEUED,
      }
    );
  } else {
    await updateOutboxEntry(
      prisma,
      { id: entryId },
      {
        error: errorMessage,
        nextRetryAt: null,
        status: OutboxStatus.FAILED,
      }
    );
  }
}

async function markSent(prisma: DbClient, entryId: string): Promise<void> {
  try {
    await updateOutboxEntry(
      prisma,
      { id: entryId },
      {
        error: null,
        sentAt: new Date(),
        status: OutboxStatus.SENT,
      }
    );
  } catch (dbErr) {
    logger.error(
      { err: dbErr, entryId },
      "Outbox: failed to mark entry as SENT after successful send"
    );
  }
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
  const consentError = await assertWhatsAppConsent(
    prisma,
    entry.recipientPhone,
    shopPhone
  );
  if (!consentError) {
    return false;
  }
  await updateOutboxEntry(
    prisma,
    { id: entry.id },
    {
      error: `Blocked: ${consentError}`,
      status: OutboxStatus.CANCELLED,
    }
  );
  return true;
}

async function processEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  config: { apiToken: string; businessId: string; phoneNumberId: string },
  countryCode: string,
  shopPhone: string | null
): Promise<void> {
  try {
    if (entry.channel === "WHATSAPP") {
      // Consent is the law here: without it the entry is cancelled (not
      // retried) and the reason lands in the outbox error column.
      const blocked = await cancelIfConsentMissing(prisma, entry, shopPhone);
      if (blocked) {
        return;
      }
      const result = await sendWhatsApp(
        config,
        entry.recipientPhone,
        entry.renderedBody,
        countryCode
      );
      if (result.success) {
        await markSent(prisma, entry.id);
      } else {
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
    } else {
      logger.warn(
        `Outbox: unexpected channel "${entry.channel}" for entry ${entry.id} — marking FAILED`
      );
      try {
        await updateOutboxEntry(
          prisma,
          { id: entry.id },
          {
            error: `Unsupported channel: ${entry.channel}`,
            status: OutboxStatus.FAILED,
          }
        );
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

    const config = await getWhatsAppConfig(prisma);
    if (!config) {
      return;
    }

    const shopSettings = await findShopSettingsUnique(prisma);
    const countryCode = shopSettings?.countryCode ?? "PT";

    for (const entry of pending) {
      await processEntry(
        prisma,
        entry,
        config,
        countryCode,
        shopSettings?.phone ?? null
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

async function getWhatsAppConfig(prisma: DbClient): Promise<{
  apiToken: string;
  businessId: string;
  phoneNumberId: string;
} | null> {
  const row = await findShopSettingsUnique(prisma);
  if (!row) {
    return null;
  }

  if (
    !(
      row.whatsappApiTokenEncrypted &&
      row.whatsappBusinessId &&
      row.whatsappPhoneNumberId
    )
  ) {
    return null;
  }

  return decryptWhatsAppConfig({
    apiTokenEncrypted: row.whatsappApiTokenEncrypted,
    businessId: row.whatsappBusinessId,
    phoneNumberId: row.whatsappPhoneNumberId,
  });
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
  return await updateOutboxEntry(
    prisma,
    { id },
    { status: OutboxStatus.CANCELLED }
  );
}

export async function testNotification(prisma: DbClient, templateId: string) {
  const template = await findNotificationTemplateUnique(prisma, templateId);
  if (!template) {
    throw new AppError("TEMPLATE_NOT_FOUND");
  }
  if (template.channel !== "WHATSAPP") {
    throw new AppError("TEMPLATE_NOT_FOUND");
  }
  const shop = await findShopSettingsUnique(prisma);
  const phone = shop?.phone;
  if (!phone) {
    throw new AppError("NO_SHOP_PHONE");
  }
  await queueNotification(prisma, {
    channel: "WHATSAPP" as const,
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
