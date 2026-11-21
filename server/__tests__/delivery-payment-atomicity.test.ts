/**
 * Integration test: delivery + handover payment atomicity and the
 * send-vs-deliver race against a real, temporary PostgreSQL database.
 *
 * The unit mocks cannot roll back writes, so these cases run against a
 * throwaway database (`prisma migrate deploy`, skipped when no
 * PostgreSQL is reachable — same harness as loaner-concurrency.test.ts):
 *
 *  - a refused delivery (open external repair) leaves no payment row;
 *  - a failure AFTER the payment insert rolls back payment AND status;
 *  - a successful delivery persists the payment in the same commit;
 *  - a concurrent send and deliver can't both win — the job-row lock
 *    serializes them and the loser sees the committed state.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExternalRepair } from "../services/external-repair.service.js";
import { transitionStatus } from "../services/job.service.js";

const DB_NAME = `delivery_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const baseUrl = process.env.DATABASE_URL as string;
const m = (baseUrl ?? "").match(
  /^(postgresql:\/\/(?:[^/@:]+(?::[^/]*)?@)?[^/]+)\/([^?]+)(.*)$/
);
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
      "[delivery-it] no PostgreSQL reachable — tests will skip:",
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
    console.error(`[delivery-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDbUrl }),
  });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma
      .$executeRawUnsafe("DROP TRIGGER IF EXISTS reject_delivered_test ON jobs")
      .catch(() => {
        // best-effort
      });
    await prisma
      .$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_delivered_for_test()")
      .catch(() => {
        // best-effort
      });
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

const seedGraph = async (db: PrismaClient, tag: string) => {
  const user = await db.user.create({
    data: {
      email: `staff-${tag}@test.local`,
      name: `Staff ${tag}`,
      role: "OWNER",
      username: `staff-${tag}`,
    },
  });
  const customer = await db.customer.create({
    data: { name: `Customer ${tag}`, phone: `+351900${tag}` },
  });
  const brand = await db.brand.create({ data: { name: `Brand-${tag}` } });
  const device = await db.device.create({
    data: { brandId: brand.id, model: `Model-${tag}` },
  });
  const supplier = await db.supplier.create({
    data: { name: `Supplier-${tag}` },
  });
  return { customer, device, supplier, user };
};

const jobFields = (g: Awaited<ReturnType<typeof seedGraph>>, code: string) => ({
  accessCode: `ac-${code}`,
  createdById: g.user.id,
  customerId: g.customer.id,
  deviceId: g.device.id,
  jobCode: `R-2026-${code}`,
  reportedProblem: "cracked screen",
  status: "DONE" as const,
});

const deliverWithPayment = (
  db: PrismaClient,
  jobId: string,
  userId: string,
  amount = 40
) =>
  transitionStatus(
    db,
    jobId,
    "DELIVERED",
    userId,
    { prisma: db },
    {
      payment: { amount, method: "CASH" },
      requestingRole: "OWNER",
    }
  );

describe.skipIf(!serverReachable)(
  "delivery payment atomicity (integration)",
  () => {
    it("a refused delivery leaves no payment row behind", async () => {
      const db = getPrisma();
      const g = await seedGraph(db, "d0001");
      const job = await db.job.create({
        data: { ...jobFields(g, "d0001"), status: "DONE" },
      });
      await db.jobRepair.create({
        data: {
          category: "HARDWARE",
          createdById: g.user.id,
          jobId: job.id,
          price: 100,
          repairName: "Screen",
        },
      });
      await db.externalRepair.create({
        data: {
          createdById: g.user.id,
          jobId: job.id,
          supplierId: g.supplier.id,
        },
      });

      const result = (await deliverWithPayment(db, job.id, g.user.id)) as {
        error?: string;
        allowedTransitions?: string[];
      };
      expect(result.error).toBe("CONFLICT_STATUS_TRANSITION");
      // DELIVERED must not be advertised as an alternative while the
      // device is still out at the repairer.
      expect(result.allowedTransitions).not.toContain("DELIVERED");

      expect(await db.payment.count({ where: { jobId: job.id } })).toBe(0);
      expect(
        (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status
      ).toBe("DONE");
      expect(
        await db.auditLog.count({
          where: { action: "STATUS_CHANGED", jobId: job.id },
        })
      ).toBe(0);
    });

    it("rolls back the payment when the status update fails mid-transaction", async () => {
      const db = getPrisma();
      const g = await seedGraph(db, "d0002");
      const job = await db.job.create({
        data: { ...jobFields(g, "d0002") },
      });
      await db.jobRepair.create({
        data: {
          category: "HARDWARE",
          createdById: g.user.id,
          jobId: job.id,
          price: 100,
          repairName: "Screen",
        },
      });

      // Force the job UPDATE to fail AFTER the payment insert: the whole
      // transaction must roll back — no payment, no status change.
      await db.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION reject_delivered_for_test()
        RETURNS trigger AS $func$
        BEGIN
          IF NEW.status = 'DELIVERED' AND NEW."jobCode" = 'R-2026-d0002' THEN
            RAISE EXCEPTION 'forced failure after payment insert';
          END IF;
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql
      `);
      await db.$executeRawUnsafe(`
        CREATE TRIGGER reject_delivered_test
        BEFORE UPDATE OF status ON jobs
        FOR EACH ROW EXECUTE FUNCTION reject_delivered_for_test()
      `);
      try {
        await expect(
          deliverWithPayment(db, job.id, g.user.id)
        ).rejects.toThrow();
      } finally {
        await db.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS reject_delivered_test ON jobs"
        );
        await db.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS reject_delivered_for_test()"
        );
      }

      expect(await db.payment.count({ where: { jobId: job.id } })).toBe(0);
      expect(
        (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status
      ).toBe("DONE");
      expect(
        await db.auditLog.count({
          where: { action: "PAYMENT_ADDED", jobId: job.id },
        })
      ).toBe(0);
    });

    it("persists the handover payment in the same commit as the delivery", async () => {
      const db = getPrisma();
      const g = await seedGraph(db, "d0003");
      const job = await db.job.create({
        data: { ...jobFields(g, "d0003") },
      });
      await db.jobRepair.create({
        data: {
          category: "HARDWARE",
          createdById: g.user.id,
          jobId: job.id,
          price: 100,
          repairName: "Screen",
        },
      });

      const result = await deliverWithPayment(db, job.id, g.user.id, 40);
      expect("error" in (result as object)).toBe(false);

      const payments = await db.payment.findMany({ where: { jobId: job.id } });
      expect(payments).toHaveLength(1);
      expect(Number(payments[0].amount)).toBe(40);
      expect(payments[0].method).toBe("CASH");
      expect(payments[0].createdById).toBe(g.user.id);
      expect(
        (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status
      ).toBe("DELIVERED");
    });

    it("send and deliver can't both win — the loser sees committed state", async () => {
      const db = getPrisma();
      const g = await seedGraph(db, "d0004");
      const job = await db.job.create({
        data: { ...jobFields(g, "d0004") },
      });

      const [delivered, sent] = await Promise.allSettled([
        deliverWithPayment(db, job.id, g.user.id, 10),
        createExternalRepair(
          db,
          job.id,
          { kind: "REPAIRER", supplierId: g.supplier.id },
          g.user.id
        ),
      ]);

      const deliveryWon =
        delivered.status === "fulfilled" &&
        !("error" in (delivered.value as object));
      const sendWon = sent.status === "fulfilled";
      // Exactly one side may succeed — never both, never neither.
      expect(deliveryWon !== sendWon).toBe(true);

      const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
      const openRepair = await db.externalRepair.findFirst({
        where: { jobId: job.id, status: "SENT" },
      });
      // The forbidden end state: device delivered AND still out at the
      // repairer.
      expect(!(after.status === "DELIVERED" && openRepair !== null)).toBe(true);

      if (deliveryWon) {
        expect(await db.payment.count({ where: { jobId: job.id } })).toBe(1);
        expect(openRepair).toBeNull();
      } else {
        expect(after.status).toBe("DONE");
        expect(openRepair).not.toBeNull();
        expect(await db.payment.count({ where: { jobId: job.id } })).toBe(0);
      }
    });
  }
);
