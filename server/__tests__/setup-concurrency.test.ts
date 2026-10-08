/**
 * Integration test: first-run setup against a real, temporary PostgreSQL
 * database — the advisory lock + in-transaction count must let exactly one
 * of several concurrent requests create the owner, and the stored hash must
 * verify through better-auth's own password check.
 *
 * Same harness as seed-whatsapp-templates.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable (the CI
 * `check` job always provides one).
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isAppError } from "@shared/errors/app-error.js";
import { verifyPassword } from "better-auth/crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirstOwner, isSetupNeeded } from "../services/setup.service.js";

const DB_NAME = `setup_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const baseUrl = process.env.DATABASE_URL as string;
const m = baseUrl.match(
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
      "[setup-it] no PostgreSQL reachable — tests will skip:",
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
    console.error(`[setup-it] migrate output:\n${migrate.output}`);
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

describe.skipIf(!serverReachable)("first-run setup (integration)", () => {
  it("lets exactly one of several concurrent requests create the owner", async () => {
    const db = getPrisma();
    expect(await isSetupNeeded(db)).toBe(true);

    const attempts = await Promise.allSettled(
      ["dono", "intruso1", "intruso2", "intruso3"].map((login) =>
        createFirstOwner(db, {
          shopName: `Loja ${login}`,
          name: login,
          login,
          password: "Segura123",
        })
      )
    );

    const ok = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter(
      (a): a is PromiseRejectedResult => a.status === "rejected"
    );
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(isAppError(r.reason) && r.reason.code).toBe("SETUP_ALREADY_DONE");
    }

    expect(await db.user.count()).toBe(1);
    expect(await isSetupNeeded(db)).toBe(false);

    const owner = await db.user.findFirstOrThrow({
      include: { accounts: true },
    });
    expect(owner.role).toBe("OWNER");
    expect(owner.mustChangePassword).toBe(false);
    const credential = owner.accounts.find(
      (a) => a.providerId === "credential"
    );
    expect(credential?.password).toBeTruthy();
    expect(
      await verifyPassword({
        hash: credential?.password as string,
        password: "Segura123",
      })
    ).toBe(true);

    const shop = await db.shopSettings.findUniqueOrThrow({
      where: { id: "default" },
    });
    expect(shop.shopName).toBe(`Loja ${owner.username}`);
  });
});
