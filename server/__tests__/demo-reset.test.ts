/**
 * Integration test: the demo seed/reset cycle against a real, temporary
 * PostgreSQL database — seed, mutate the data, reset, and the dataset is
 * back at the dump state with "demo" as the only user.
 *
 * Same harness as setup-concurrency.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable (the
 * CI `check` job always provides one). The database name contains
 * "demo_it_" so it passes the seed's own database-name guard.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvForTests } from "../config/env.js";

const DB_NAME = `demo_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const DEMO_NAME_RE = /demo/;

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
      "[demo-reset-it] no PostgreSQL reachable — tests will skip:",
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
    console.error(`[demo-reset-it] migrate output:\n${migrate.output}`);
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

describe.skipIf(!serverReachable)("demo seed/reset (integration)", () => {
  it("refuses a database whose name does not contain 'demo'", async () => {
    process.env.DEMO_MODE = "true";
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = (testDbUrl as string).replace(
      DB_NAME,
      "reparilo_prod"
    );
    resetEnvForTests();
    try {
      const { assertDemoDatabase } = await import("../lib/demo.js");
      expect(() => assertDemoDatabase(process.env.DATABASE_URL)).toThrow(
        DEMO_NAME_RE
      );
      // Substring "demo" is not enough — only an exact or _-delimited
      // match passes, so "demolition" can never wipe a real shop.
      expect(() =>
        assertDemoDatabase(
          (testDbUrl as string).replace(DB_NAME, "oficinaosdemodb")
        )
      ).toThrow(DEMO_NAME_RE);
      expect(() => assertDemoDatabase(testDbUrl as string)).not.toThrow();
      expect(() =>
        assertDemoDatabase(
          (testDbUrl as string).replace(DB_NAME, "oficinaos_demo")
        )
      ).not.toThrow();
      // Percent-encoded names are compared decoded.
      expect(() =>
        assertDemoDatabase(
          (testDbUrl as string).replace(DB_NAME, "oficinaos_%64emo")
        )
      ).not.toThrow();
    } finally {
      process.env.DATABASE_URL = saved;
      resetEnvForTests();
    }
  });

  it("seed → mutate → reset restores the dump and keeps only the demo user", async () => {
    process.env.DEMO_MODE = "true";
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testDbUrl as string;
    resetEnvForTests();
    try {
      const db = getPrisma();
      const { seedDemo } = await import("../../prisma/seed-demo.js");
      const dump = await seedDemo(db as never);

      // Sanity: the dataset is real — users, customers, jobs all present.
      expect(await db.user.count()).toBe(1);
      expect(await db.customer.count()).toBeGreaterThan(20);
      expect(await db.job.count()).toBeGreaterThan(40);

      // Mutate: delete rows, tweak one, add a rogue user — the reset
      // must undo all of it. (auditLog/jobNote have no inbound FKs, so
      // plain deleteMany is legal here.)
      await db.auditLog.deleteMany({ where: { id: { endsWith: "1" } } });
      await db.jobNote.deleteMany({});
      expect(await db.jobNote.count()).toBe(0);
      await db.customer.updateMany({ data: { name: "ALTERADO" } });
      await db.user.create({
        data: {
          email: "rogue@exemplo.example",
          emailVerified: true,
          name: "rogue",
          role: "OWNER",
          username: "rogue",
        },
      });
      expect(await db.user.count()).toBe(2);

      // A live visitor session — the hourly TRUNCATE used to log everyone
      // out; the reset must re-insert sessions that survive the replay.
      const demoUser = await db.user.findFirstOrThrow({
        where: { username: "demo" },
      });
      const liveSession = await db.session.create({
        data: {
          token: `it-session-${Math.random().toString(36).slice(2)}`,
          userId: demoUser.id,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      // And one tied to the rogue user — it must NOT come back.
      const rogue = await db.user.findFirstOrThrow({
        where: { username: "rogue" },
      });
      await db.session.create({
        data: {
          token: `it-rogue-${Math.random().toString(36).slice(2)}`,
          userId: rogue.id,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const { applyDemoDump } = await import("../../prisma/seed-demo.js");
      await applyDemoDump(db as never, dump);

      const counts = {
        customers: await db.customer.count(),
        jobs: await db.job.count(),
        users: await db.user.count(),
        jobNotes: await db.jobNote.count(),
        auditLogs: await db.auditLog.count(),
      };
      const dumpCounts = Object.fromEntries(
        dump.map(([delegate, rows]) => [delegate, rows.length])
      );
      expect(counts.customers).toBe(dumpCounts.customer);
      expect(counts.jobs).toBe(dumpCounts.job);
      // Deleted rows are restored to the dump's exact counts.
      expect(counts.jobNotes).toBe(dumpCounts.jobNote);
      expect(counts.auditLogs).toBe(dumpCounts.auditLog);
      // Exactly one user, active, username "demo" — the rogue row is gone.
      expect(counts.users).toBe(1);
      const only = await db.user.findFirstOrThrow();
      expect(only.username).toBe("demo");
      expect(only.isActive).toBe(true);
      // No leftover "ALTERADO" names.
      expect(await db.customer.count({ where: { name: "ALTERADO" } })).toBe(0);

      // The demo visitor's session survived the wipe; the rogue user's
      // did not (its owner was reset away).
      const sessions = await db.session.findMany();
      expect(sessions.map((s) => s.id)).toEqual([liveSession.id]);
    } finally {
      process.env.DATABASE_URL = saved;
      resetEnvForTests();
    }
  }, 90_000);
});
