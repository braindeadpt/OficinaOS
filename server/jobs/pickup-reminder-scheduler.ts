import { Role } from "@shared/constants/roles";
import type { FastifyInstance } from "fastify";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import { notify } from "../services/notification-dispatch.js";
import {
  resolveWhatsAppChannel,
  sendWhatsAppTemplateVia,
} from "../services/whatsapp-channel.js";
import { isModuleEnabled } from "../utils/modules.js";

const INTERVAL_MS = 15 * 60 * 1000;
// Business rule: nudge the customer once the repair has been sitting DONE
// (ready, uncollected) for 3 days, then re-nudge every 72 h while it stays
// uncollected. Both windows are deliberately generous — this is a courtesy
// reminder, not a deadline escalation like the overdue alert.
const READY_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const RE_REMIND_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_PER_TICK = 100;
// Meta template language for the business-initiated reminder (same
// convention as the remarketing sweep).
const TEMPLATE_LANG = "pt";
const WHITESPACE_RE = /\s+/;

/**
 * WhatsApp leg: Meta transports deliver business-initiated messages only
 * as APPROVED templates — the reminder lands days after the customer's
 * last message, always outside the 24h window, so freeform text would be
 * rejected. Sends the configured template directly (same convention as
 * the remarketing sweep); a failure is logged and the claim stands.
 */
async function sendReminderTemplate(
  app: FastifyInstance,
  shop: NonNullable<Awaited<ReturnType<typeof findShopSettingsUnique>>>,
  channel: NonNullable<ReturnType<typeof resolveWhatsAppChannel>>,
  template: string,
  job: ReminderCandidate
): Promise<void> {
  if (!job.customerPhone) {
    return;
  }
  const firstName =
    (job.customerName ?? "").trim().split(WHITESPACE_RE)[0] ||
    (job.customerName ?? "");
  const sent = await sendWhatsAppTemplateVia(
    app.prisma,
    channel,
    job.customerPhone,
    template,
    TEMPLATE_LANG,
    [firstName, job.jobCode, shop.shopName ?? ""],
    shop.countryCode ?? "PT",
    shop
  );
  if (!sent.success) {
    app.log.warn(
      { err: sent.error, jobId: job.id },
      "pickup reminder template send failed"
    );
  }
}

interface ReminderCandidate {
  customerName: string | null;
  customerPhone: string | null;
  id: string;
  jobCode: string;
}

async function processPickupReminders(app: FastifyInstance): Promise<void> {
  const readyBefore = new Date(Date.now() - READY_AGE_MS);
  const reRemindBefore = new Date(Date.now() - RE_REMIND_MS);

  // Skip the whole tick when no customer channel can deliver: otherwise
  // the in-app "reminder sent" record fires while nothing is queued.
  const shop = await findShopSettingsUnique(app.prisma);
  const messagingEnabled =
    Boolean(shop?.whatsappEnabled) ||
    (Boolean(shop?.smsEnabled) && isModuleEnabled(shop, "sms"));
  if (!messagingEnabled) {
    return;
  }

  // WhatsApp Meta transports (meta/cloud) only deliver business-initiated
  // messages as APPROVED templates — the reminder lands days after the
  // last customer message, always outside the 24h window, so freeform
  // text is rejected. When a template is configured the WhatsApp leg is
  // sent directly here (like the remarketing sweep) and notify() covers
  // the in-app record + SMS. Evolution (Baileys) has no window and keeps
  // the freeform outbox path; a missing template falls back to it too
  // (on Meta it fails and stays FAILED in the outbox — visible signal).
  const waChannel = shop?.whatsappEnabled ? resolveWhatsAppChannel(shop) : null;
  const metaTemplate =
    waChannel && waChannel.mode !== "evolution" && shop?.pickupReminderTemplate
      ? shop.pickupReminderTemplate
      : null;

  // "Entered DONE" is read from the STATUS_CHANGED audit trail — updatedAt
  // would lie (any edit to a DONE job bumps it and the reminder window
  // would keep sliding). Jobs without an audit row fall back to updatedAt.
  // Only jobs still status DONE are eligible, which already excludes
  // DELIVERED / RETURNED / CANCELLED.
  // Consent + phone required here (same gate the SMS/WhatsApp handlers
  // apply at enqueue) so a reminder is only claimed when it can send.
  const candidates = await app.prisma.$queryRaw<ReminderCandidate[]>`
    SELECT j.id,
           j."jobCode",
           c.name  AS "customerName",
           c.phone AS "customerPhone"
    FROM "jobs" j
    LEFT JOIN "customers" c ON c.id = j."customerId"
    WHERE j.status = 'DONE'
      AND c."whatsappConsent" = true
      AND NULLIF(BTRIM(c.phone), '') IS NOT NULL
      AND (j."lastPickupReminderAt" IS NULL
           OR j."lastPickupReminderAt" < ${reRemindBefore})
      AND COALESCE(
            (SELECT MAX(a."createdAt")
               FROM "audit_logs" a
              WHERE a."jobId" = j.id
                AND a.action = 'STATUS_CHANGED'
                AND a."toValue" = 'DONE'),
            j."updatedAt"
          ) < ${readyBefore}
    LIMIT ${MAX_PER_TICK}
  `;

  const BATCH_SIZE = 5;
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((job) =>
        // Atomic claim first — two overlapping ticks must not both pass
        // the eligibility filter and double-remind. Stamping on attempt
        // also prevents a broken pipeline from spamming every 15 min.
        // Raw UPDATE so the claim does not bump the automatic
        // `updatedAt` — the pickup dashboard shows it as the ready date
        // and a reminder must not reset the displayed waiting days.
        app.prisma.$executeRaw`
            UPDATE "jobs"
            SET "lastPickupReminderAt" = ${new Date()}
            WHERE id = ${job.id}
              AND status = 'DONE'
              AND ("lastPickupReminderAt" IS NULL
                   OR "lastPickupReminderAt" < ${reRemindBefore})
          `.then(async (claimed) => {
          if (claimed === 0) {
            return;
          }
          if (metaTemplate && waChannel && shop) {
            await sendReminderTemplate(app, shop, waChannel, metaTemplate, job);
          }
          return notify(app, {
            context: {
              customerName: job.customerName ?? undefined,
              jobCode: job.jobCode,
              recipientPhone: job.customerPhone ?? undefined,
            },
            // O leg WhatsApp já saiu como template Meta — sem ele o
            // outbox tentaria texto livre e falharia fora da janela.
            excludeChannels: metaTemplate ? ["WHATSAPP"] : undefined,
            eventName: "job_done_reminder",
            jobId: job.id,
            recipients: { role: Role.OWNER },
          });
        })
      )
    );
    results.push(...batchResults);
  }
  for (const r of results) {
    if (r.status === "rejected") {
      app.log.warn({ err: r.reason }, "failed to send pickup reminder");
    }
  }
}

export function startPickupReminderScheduler(app: FastifyInstance): () => void {
  const tick = async (): Promise<void> => {
    try {
      await processPickupReminders(app);
    } catch (err) {
      app.log.error(err, "pickup reminder scheduler tick failed");
    }
  };

  const handle = setInterval(tick, INTERVAL_MS);
  tick().catch((err) =>
    app.log.error(err, "pickup reminder scheduler initial tick failed")
  );

  return () => {
    clearInterval(handle);
  };
}
