import { INACTIVE_STATUSES } from "@shared/constants/job-statuses";
import { Role } from "@shared/constants/roles";
import type { FastifyInstance } from "fastify";
import { notify } from "../services/notification-dispatch.js";

const INTERVAL_MS = 15 * 60 * 1000;
const RE_ALERT_MS = 24 * 60 * 60 * 1000;

async function processOverdueJobs(app: FastifyInstance): Promise<void> {
  const cutoff = new Date(Date.now() - RE_ALERT_MS);
  const overdue = await app.prisma.job.findMany({
    select: {
      customer: { select: { name: true, phone: true } },
      id: true,
      jobCode: true,
    },
    where: {
      estimatedDate: { lt: new Date() },
      status: { notIn: INACTIVE_STATUSES },
      OR: [
        { lastOverdueAlertAt: null },
        { lastOverdueAlertAt: { lt: cutoff } },
      ],
    },
  });

  const BATCH_SIZE = 5;
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < overdue.length; i += BATCH_SIZE) {
    const batch = overdue.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((job) =>
        notify(app, {
          context: {
            customerName: job.customer?.name,
            jobCode: job.jobCode,
            recipientPhone: job.customer?.phone,
          },
          eventName: "job_overdue",
          jobId: job.id,
          recipients: { role: Role.OWNER },
        }).then(() =>
          app.prisma.job.update({
            data: { lastOverdueAlertAt: new Date() },
            where: { id: job.id },
          })
        )
      )
    );
    results.push(...batchResults);
  }
  for (const r of results) {
    if (r.status === "rejected") {
      app.log.warn({ err: r.reason }, "failed to send overdue notification");
    }
  }
}

export function startOverdueScheduler(app: FastifyInstance): () => void {
  const tick = async (): Promise<void> => {
    try {
      await processOverdueJobs(app);
    } catch (err) {
      app.log.error(err, "overdue scheduler tick failed");
    }
  };

  const handle = setInterval(tick, INTERVAL_MS);
  tick().catch((err) =>
    app.log.error(err, "overdue scheduler initial tick failed")
  );

  return () => {
    clearInterval(handle);
  };
}
