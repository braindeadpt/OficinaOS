/**
 * Integration test: pickup-reminder eligibility, cooldown and claim
 * deduplication against a real, temporary PostgreSQL database.
 *
 * Same harness as demo-reset.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable (the
 * CI `check` job always provides one). The scheduler and the whole
 * notify → outbox pipeline run for real — only the transports are never
 * started, so nothing is actually sent.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = `pickup_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const baseUrl = process.env.DATABASE_URL as string;
const DATABASE_URL_RE =
  /^(postgresql:\/\/(?:[^/@:]+(?::[^/]*)?@)?[^/]+)\/([^?]+)(.*)$/;
const m = baseUrl?.match(DATABASE_URL_RE);
const adminUrl = m ? `${m[1]}/postgres${m[3] ?? ""}` : null;
const testDbUrl = m ? `${m[1]}/${DB_NAME}${m[3] ?? ""}` : null;

let serverReachable = false;
if (m && adminUrl) {
  const probe = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 3000,
  });
  try {
    await probe.connect();
    serverReachable = true;
  } catch (err) {
    console.warn(
      "[pickup-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => {
      // best-effort probe teardown
    });
  }
}

let adminClient: Client | null = null;
let prisma: PrismaClient | null = null;

const run = async (
  command: string,
  args: string[]
): Promise<{ code: number; output: string }> => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDbUrl as string },
    // bunx is a .cmd shim on Windows — needs a shell to resolve.
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (c: Buffer) => (output += c.toString()));
  child.stderr?.on("data", (c: Buffer) => (output += c.toString()));
  const code = await new Promise<number>((resolve) => {
    child.on("close", resolve);
    child.on("error", () => resolve(-1));
  });
  return { code, output };
};

const getPrisma = (): PrismaClient => {
  if (!prisma) {
    throw new Error("integration prisma client missing — beforeAll failed?");
  }
  return prisma;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const noop = () => undefined;
const app = () =>
  ({
    log: { error: noop, info: noop, warn: noop },
    prisma: getPrisma(),
  }) as never;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timed out");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!(adminUrl && testDbUrl && serverReachable)) {
    return;
  }
  adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);

  const migrate = await run("bunx", ["prisma", "migrate", "deploy"]);
  if (migrate.code !== 0) {
    console.error(`[pickup-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDbUrl }),
  });

  const db = getPrisma();
  // Minimal shop: WhatsApp enabled + Meta template configured so the
  // whole chain (scheduler → dispatch → outbox.metaTemplate) is covered.
  await db.shopSettings.create({
    data: {
      id: "default",
      pickupReminderTemplate: "oficinaos_pickup_reminder",
      shopName: "Loja IT",
      whatsappEnabled: true,
    },
  });
  const user = await db.user.create({
    data: {
      email: "owner@it.local",
      name: "Owner IT",
      role: "OWNER",
      username: "ownerit",
    },
  });
  const brand = await db.brand.create({ data: { name: "Apple" } });
  const device = await db.device.create({
    data: { brandId: brand.id, model: "iPhone 13" },
  });
  const customer = await db.customer.create({
    data: {
      name: "Ana Silva",
      phone: "+351910000099",
      whatsappConsent: true,
    },
  });

  const makeJob = async (
    jobCode: string,
    opts: { lastReminderAt?: Date | null } = {}
  ) =>
    db.job.create({
      data: {
        accessCode: `acc-${jobCode}`,
        createdById: user.id,
        customerId: customer.id,
        deviceId: device.id,
        jobCode,
        lastPickupReminderAt: opts.lastReminderAt ?? null,
        reportedProblem: "Ecrã partido",
        status: "DONE",
      },
    });

  const markDoneAt = async (jobId: string, when: Date) => {
    await db.auditLog.create({
      data: {
        action: "STATUS_CHANGED",
        createdAt: when,
        fromValue: "IN_REPAIR",
        jobId,
        toValue: "DONE",
        userId: user.id,
      },
    });
  };

  // Eligible: DONE via audit 4 days ago, never reminded.
  const old = await makeJob("IT-OLD");
  await markDoneAt(old.id, new Date(Date.now() - 4 * DAY_MS));

  // Not eligible: entered DONE only yesterday.
  const recent = await makeJob("IT-RECENT");
  await markDoneAt(recent.id, new Date(Date.now() - 1 * DAY_MS));

  // Cooldown active: DONE 4d ago but reminded 1h ago.
  const cooling = await makeJob("IT-COOLING", {
    lastReminderAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  await markDoneAt(cooling.id, new Date(Date.now() - 4 * DAY_MS));

  // Cooldown expired: DONE 4d ago, last reminder 4d ago (> 72h window).
  const reRemind = await makeJob("IT-RE", {
    lastReminderAt: new Date(Date.now() - 4 * DAY_MS),
  });
  await markDoneAt(reRemind.id, new Date(Date.now() - 5 * DAY_MS));

  // No audit row: falls back to updatedAt — age it with raw SQL because
  // @updatedAt would otherwise stay at creation time.
  const fallback = await makeJob("IT-FALLBACK");
  await db.$executeRaw`
    UPDATE "jobs" SET "updatedAt" = ${new Date(Date.now() - 4 * DAY_MS)}
    WHERE id = ${fallback.id}
  `;

  (globalThis as Record<string, unknown>).__pickupIt = {
    cooling,
    fallback,
    old,
    recent,
    reRemind,
    userId: user.id,
  };
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect().catch(() => {
      // best-effort
    });
  }
  if (adminClient) {
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
      .catch(() => {
        // best-effort
      });
    await adminClient.end().catch(() => {
      // best-effort
    });
  }
});

const ids = () =>
  (globalThis as Record<string, unknown>).__pickupIt as Record<
    string,
    { id: string }
  > & { userId: string };

const outboxFor = async (jobId: string) =>
  getPrisma().notificationOutbox.findMany({ where: { jobId } });

describe.skipIf(!serverReachable)(
  "pickup reminder scheduler (integration)",
  () => {
    it("reminds only jobs DONE for 3+ days via the audit trail, with metaTemplate on the outbox entry", async () => {
      const { startPickupReminderScheduler } = await import(
        "../jobs/pickup-reminder-scheduler.js"
      );
      const stop = startPickupReminderScheduler(app());
      try {
        await waitFor(async () => (await outboxFor(ids().old.id)).length === 1);
        // Give the other candidates a beat — none should produce entries.
        await sleep(1500);

        expect(await outboxFor(ids().recent.id)).toHaveLength(0);
        expect(await outboxFor(ids().cooling.id)).toHaveLength(0);

        const entry = (await outboxFor(ids().old.id))[0];
        expect(entry.templateName).toBe("job_done_reminder");
        expect(entry.channel).toBe("WHATSAPP");
        expect(entry.recipientPhone).toBe("+351910000099");
        // Dispatch resolved the configured Meta template end-to-end.
        expect(entry.metaTemplate).toMatchObject({
          language: "pt",
          name: "oficinaos_pickup_reminder",
        });
        expect((entry.metaTemplate as { params: string[] }).params).toEqual([
          "Ana",
          "IT-OLD",
          "Loja IT",
        ]);

        const job = await getPrisma().job.findUnique({
          where: { id: ids().old.id },
        });
        expect(job?.lastPickupReminderAt).not.toBeNull();
      } finally {
        stop();
      }
    }, 30_000);

    it("re-reminds once the 72h cooldown expires", async () => {
      const { startPickupReminderScheduler } = await import(
        "../jobs/pickup-reminder-scheduler.js"
      );
      const stop = startPickupReminderScheduler(app());
      try {
        await waitFor(
          async () => (await outboxFor(ids().reRemind.id)).length === 1
        );
        await sleep(1500);
        // The audit-based eligibility from test 1 already claimed IT-OLD —
        // a second tick must not double-remind it either.
        expect(await outboxFor(ids().old.id)).toHaveLength(1);
        expect(await outboxFor(ids().recent.id)).toHaveLength(0);
      } finally {
        stop();
      }
    }, 30_000);

    it("falls back to updatedAt for jobs without an audit row", async () => {
      const { startPickupReminderScheduler } = await import(
        "../jobs/pickup-reminder-scheduler.js"
      );
      const stop = startPickupReminderScheduler(app());
      try {
        await waitFor(
          async () => (await outboxFor(ids().fallback.id)).length === 1
        );
      } finally {
        stop();
      }
    }, 30_000);

    it("two overlapping ticks produce a single claim per job", async () => {
      // Fresh eligible job so this test is independent of earlier claims.
      const db = getPrisma();
      const job = await db.job.create({
        data: {
          accessCode: "acc-IT-RACE",
          createdById: ids().userId,
          customerId: (
            await db.customer.findUniqueOrThrow({
              where: { phone: "+351910000099" },
            })
          ).id,
          deviceId: (
            await db.device.findFirstOrThrow({ where: { model: "iPhone 13" } })
          ).id,
          jobCode: "IT-RACE",
          reportedProblem: "Bateria",
          status: "DONE",
        },
      });
      const user = await db.user.findFirstOrThrow({
        where: { username: "ownerit" },
      });
      await db.auditLog.create({
        data: {
          action: "STATUS_CHANGED",
          createdAt: new Date(Date.now() - 4 * DAY_MS),
          fromValue: "IN_REPAIR",
          jobId: job.id,
          toValue: "DONE",
          userId: user.id,
        },
      });

      const { startPickupReminderScheduler } = await import(
        "../jobs/pickup-reminder-scheduler.js"
      );
      const stopA = startPickupReminderScheduler(app());
      const stopB = startPickupReminderScheduler(app());
      try {
        await waitFor(async () => (await outboxFor(job.id)).length >= 1);
        await sleep(1500);
        expect(await outboxFor(job.id)).toHaveLength(1);
      } finally {
        stopA();
        stopB();
      }
    }, 30_000);
  }
);
