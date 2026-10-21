/**
 * Integration test: the task_rules migration must NULL out dangling
 * assigneeId values BEFORE adding the FK — installs that already ran
 * the #85 rules can hold ids of users deleted since, and the bare
 * ADD CONSTRAINT would abort on them.
 *
 * Same harness as setup-concurrency.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = `taskrules_it_${process.pid}_${Math.random()
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
      "[taskrules-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => {
      // best-effort probe teardown
    });
  }
}

const CLEANUP_STMT = /UPDATE "task_rules"[\s\S]*?;/;

let adminClient: Client | null = null;
let pg: Client | null = null;
let prisma: PrismaClient | null = null;

const run = async (
  command: string,
  args: string[]
): Promise<{ code: number; output: string }> => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDbUrl as string },
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
    console.error(`[taskrules-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  pg = new Client({ connectionString: testDbUrl });
  await pg.connect();
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
  if (pg) {
    await pg.end().catch(() => {
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

describe.skipIf(!serverReachable)("task_rules migration (integration)", () => {
  it("nulls a dangling assigneeId before the FK is added", async () => {
    const db = prisma as PrismaClient;
    const sql = pg as Client;
    const owner = await db.user.create({
      data: {
        username: `owner-${DB_NAME}`,
        email: `owner-${DB_NAME}@t.pt`,
        role: "OWNER",
      },
    });

    // Simulate a pre-migration install: a rule pointing at a user that
    // no longer exists. The FK must be dropped first — that's exactly
    // the state the migration file has to survive.
    await sql.query(
      'ALTER TABLE "task_rules" DROP CONSTRAINT "task_rules_assigneeId_fkey"'
    );
    await db.taskRule.create({
      data: {
        title: "Regra antiga",
        triggerStatus: "INTAKE",
        assigneeId: "ghost-user-deleted-long-ago",
        createdById: owner.id,
      },
    });

    // The cleanup statement, run verbatim from the migration file —
    // proving what the migration does, not a retyped copy of it.
    const migrationSql = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20261109000000_task_rules_cursor_assignee/migration.sql"
      ),
      "utf8"
    );
    const cleanup = migrationSql.match(CLEANUP_STMT);
    expect(cleanup).toBeTruthy();
    await sql.query(cleanup?.[0] as string);

    const rule = await db.taskRule.findFirstOrThrow();
    expect(rule.assigneeId).toBeNull();

    // …and the FK the migration adds afterwards must now apply cleanly.
    await sql.query(
      'ALTER TABLE "task_rules" ADD CONSTRAINT "task_rules_assigneeId_fkey" ' +
        'FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ' +
        "ON DELETE SET NULL ON UPDATE CASCADE"
    );
  });
});
