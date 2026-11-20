import { Role } from "@shared/constants/roles";
import type { FastifyInstance } from "fastify";
import { notify } from "../services/notification-dispatch.js";

const INTERVAL_MS = 15 * 60 * 1000;
// Business rule: nudge the customer once the repair has been sitting DONE
// (ready, uncollected) for 3 days, then re-nudge every 72 h while it stays
// uncollected. Both windows are deliberately generous — this is a courtesy
// reminder, not a deadline escalation like the overdue alert.
const READY_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const RE_REMIND_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_PER_TICK = 100;

interface ReminderCandidate {
  customerName: string | null;
  customerPhone: string | null;
  id: string;
  jobCode: string;
}

async function processPickupReminders(app: FastifyInstance): Promise<void> {
  const readyBefore = new Date(Date.now() - READY_AGE_MS);
  const reRemindBefore = new Date(Date.now() - RE_REMIND_MS);

  // "Entered DONE" is read from the STATUS_CHANGED audit trail — updatedAt
  // would lie (any edit to a DONE job bumps it and the reminder window
  // would keep sliding). Jobs without an audit row fall back to updatedAt.
  // Only jobs still status DONE are eligible, which already excludes
  // DELIVERED / RETURNED / CANCELLED.
  const candidates = await app.prisma.$queryRaw<ReminderCandidate[]>`
    SELECT j.id,
           j."jobCode",
           c.name  AS "customerName",
           c.phone AS "customerPhone"
    FROM "jobs" j
    LEFT JOIN "customers" c ON c.id = j."customerId"
    WHERE j.status = 'DONE'
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
        app.prisma.job
          .updateMany({
            data: { lastPickupReminderAt: new Date() },
            where: {
              id: job.id,
              status: "DONE",
              OR: [
                { lastPickupReminderAt: null },
                { lastPickupReminderAt: { lt: reRemindBefore } },
              ],
            },
          })
          .then((claimed) => {
            if (claimed.count === 0) {
              return;
            }
            return notify(app, {
              context: {
                customerName: job.customerName ?? undefined,
                jobCode: job.jobCode,
                recipientPhone: job.customerPhone ?? undefined,
              },
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
