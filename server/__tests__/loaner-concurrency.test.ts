/**
 * Integration test: loaner fleet races against a real, temporary PostgreSQL
 * database. The unit-row FOR UPDATE + conditional updates must serialize
 * concurrent returns and concurrent checkouts — exactly one wins, the loser
 * gets a clean AppError, and audit only records the real transition.
 *
 * Same harness as setup-concurrency.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isAppError } from "@shared/errors/app-error.js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkoutLoanerDevice,
  markLoanerReturned,
} from "../services/loaner.service.js";

const DB_NAME = `loaner_it_${process.pid}_${Math.random()
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
      "[loaner-it] no PostgreSQL reachable — tests will skip:",
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
    console.error(`[loaner-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDbUrl }),
  });
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
  const unit = await db.loanerDevice.create({
    data: { brand: "Nokia", label: `Unit ${tag}`, model: "105" },
  });
  return { customer, device, unit, user };
};

const jobFields = (g: Awaited<ReturnType<typeof seedGraph>>, code: string) => ({
  accessCode: `ac-${code}`,
  createdById: g.user.id,
  customerId: g.customer.id,
  deviceId: g.device.id,
  jobCode: `R-2026-${code}`,
  reportedProblem: "cracked screen",
});

describe.skipIf(!serverReachable)("loaner concurrency (integration)", () => {
  it("lets exactly one of two concurrent returns stamp the open loan", async () => {
    const db = getPrisma();
    const g = await seedGraph(db, "r0001");
    const job = await db.job.create({
      data: {
        ...jobFields(g, "r0001"),
        hasLoanerDevice: true,
        loanerDeviceId: g.unit.id,
        loanerNote: "Unit r0001",
      },
    });

    const results = await Promise.allSettled([
      markLoanerReturned(db, g.unit.id, g.user.id),
      markLoanerReturned(db, g.unit.id, g.user.id),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    expect(ok).toHaveLength(1);
    expect(ok[0].status === "fulfilled" && ok[0].value.jobId).toBe(job.id);
    expect(rejected).toHaveLength(1);
    expect(isAppError(rejected[0].reason) && rejected[0].reason.code).toBe(
      "LOANER_NOT_ACTIVE"
    );

    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.loanerReturnedAt).not.toBeNull();
    // One return stamp, one audit row — the loser audits nothing.
    expect(
      await db.auditLog.count({
        where: { action: "LOANER_RETURNED", jobId: job.id },
      })
    ).toBe(1);
  });

  it("serializes checkout — two simultaneous intakes can't loan the same unit", async () => {
    const db = getPrisma();
    const g = await seedGraph(db, "c0001");

    // Mirrors job.service create: the unit row is locked inside the same tx
    // that writes the loaning job, so the loser blocks on FOR UPDATE and
    // then sees the committed open loan.
    const loanViaCheckout = (code: string) =>
      db.$transaction(async (tx) => {
        const checkout = await checkoutLoanerDevice(tx, g.unit.id, null);
        // Hold the row lock a beat so the loser is genuinely waiting when
        // the winner's loan commits — the race must overlap to count.
        await new Promise((r) => setTimeout(r, 150));
        return tx.job.create({
          data: {
            ...jobFields(g, code),
            hasLoanerDevice: true,
            loanerDeviceId: g.unit.id,
            loanerNote: checkout.note,
          },
        });
      });

    const results = await Promise.allSettled([
      loanViaCheckout("c001a"),
      loanViaCheckout("c001b"),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(isAppError(rejected[0].reason) && rejected[0].reason.code).toBe(
      "LOANER_DEVICE_UNAVAILABLE"
    );

    // The unit went out exactly once — no double-loan slipped through.
    expect(await db.job.count({ where: { loanerDeviceId: g.unit.id } })).toBe(
      1
    );
  });
});
