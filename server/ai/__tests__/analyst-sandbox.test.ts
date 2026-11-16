/**
 * Integration test — the AI analyst SQL sandbox (schema `analyst` + role
 * `analyst_ro` on a dedicated connection). Asserts the Postgres layer —
 * not the regexes — is what stops the attacks from the security finding:
 * derived tables, TABLE-expressions, schema-qualified reads, pg_authid
 * and the set_config('role', …) session_user escape.
 *
 * Same harness as task-rules-migration.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWED_TABLES,
  BLOCKED_COLUMNS,
  executeGetSchema,
  executeQueryDatabase,
} from "../tools.js";

const DB_NAME = `analyst_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const ANALYST_PASSWORD = "analyst_it_pw";

const baseUrl = process.env.DATABASE_URL as string;
const m = baseUrl.match(
  /^(postgresql:\/\/(?:[^/@:]+(?::[^/]*)?@)?[^/]+)\/([^?]+)(.*)$/
);
const adminUrl = m ? `${m[1]}/postgres${m[3] ?? ""}` : null;
const testDbUrl = m ? `${m[1]}/${DB_NAME}${m[3] ?? ""}` : null;
const analystDbUrl = testDbUrl?.replace(
  /^postgresql:\/\/[^/@]*@/,
  `postgresql://analyst_ro:${ANALYST_PASSWORD}@`
);

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
      "[analyst-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => undefined);
  }
}

let adminClient: Client | null = null;
let pg: Client | null = null;
let prisma: PrismaClient | null = null;
let analystDb: PrismaClient | null = null;

/** Non-null narrow for setup vars — it() blocks only run when reachable. */
function need<T>(value: T | null): T {
  if (value === null) {
    throw new Error("test db not initialized");
  }
  return value;
}

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

const maybeDescribe = describe.skipIf(!serverReachable);

beforeAll(async () => {
  if (!(adminUrl && testDbUrl && analystDbUrl && serverReachable)) {
    return;
  }
  adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);

  const migrate = await run("bunx", ["prisma", "migrate", "deploy"]);
  if (migrate.code !== 0) {
    console.error(`[analyst-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  // Provision the role's login — provision-analyst.ts does this on real
  // installs; here it is a one-liner on the throwaway cluster.
  await adminClient.query(
    `ALTER ROLE analyst_ro WITH LOGIN PASSWORD '${ANALYST_PASSWORD}'`
  );

  pg = new Client({ connectionString: testDbUrl });
  await pg.connect();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDbUrl }),
  });
  analystDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: analystDbUrl }),
  });
}, 120_000);

afterAll(async () => {
  await analystDb?.$disconnect().catch(() => undefined);
  await prisma?.$disconnect().catch(() => undefined);
  if (pg) {
    await pg.end().catch(() => undefined);
  }
  if (adminClient) {
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
      .catch(() => undefined);
    await adminClient.end().catch(() => undefined);
  }
});

maybeDescribe("analyst schema — migration shape", () => {
  it("creates one view per ALLOWED_TABLE and nothing else", async () => {
    const rows = await need(prisma).$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.views
       WHERE table_schema = 'analyst' ORDER BY table_name`
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [...ALLOWED_TABLES].sort()
    );
  });

  it("no view exposes a BLOCKED_COLUMNS column", async () => {
    const rows = await need(prisma).$queryRawUnsafe<
      { table_name: string; column_name: string }[]
    >(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'analyst'`
    );
    for (const { table_name, column_name } of rows) {
      const blocked = BLOCKED_COLUMNS[table_name];
      expect(
        blocked?.has(column_name.toLowerCase()) ?? false,
        `${table_name}.${column_name}`
      ).toBe(false);
    }
  });

  it("analyst_ro can LOGIN and read only the analyst schema", async () => {
    const who = await need(analystDb).$queryRawUnsafe<{ u: string }[]>(
      "SELECT session_user AS u"
    );
    expect(who[0]?.u).toBe("analyst_ro");
    const ok = await need(analystDb).$queryRawUnsafe<{ n: number }[]>(
      "SELECT COUNT(*)::int AS n FROM analyst.jobs"
    );
    expect(ok[0]?.n).toBe(0);
    await expect(
      need(analystDb).$queryRawUnsafe("SELECT id FROM public.jobs LIMIT 1")
    ).rejects.toThrow();
  });

  it("search_path=analyst resolves bare names to the views", async () => {
    // Without the SET LOCAL search_path inside the transaction, `jobs`
    // would resolve to public.jobs — where analyst_ro has no grant — and
    // this query would fail instead of returning a row count.
    const result = await executeQueryDatabase(
      analystDb as PrismaClient,
      "SELECT COUNT(*) AS n FROM customers"
    );
    expect(result.success).toBe(true);
  });
});

maybeDescribe(
  "analyst sandbox — attacks from the finding die at the DB",
  () => {
    const ATTACKS = [
      // The three reported shapes — all pass the regex layer, then die on
      // Postgres: analyst.<name> does not exist / public.* has no grant.
      "SELECT x FROM (SELECT password AS x FROM accounts) a",
      "SELECT a::text FROM (TABLE shop_settings) a",
      "SELECT token FROM (SELECT token FROM sessions) s",
      // Schema-qualified read of a table that DOES exist in public.
      "SELECT u.password FROM (SELECT * FROM public.users) u",
      // Superuser-only catalog with real credentials.
      "SELECT r.rolpassword FROM (SELECT * FROM pg_authid) r",
      // set_config session_user escape — analyst_ro belongs to nothing, so
      // even a slipped call can't switch back to the owner role.
      `SELECT set_config('role', 'reparilo', true), x FROM (SELECT 1 AS x) s`,
      `SELECT query_to_xml('select 1', true, true, '')`,
    ];

    for (const sql of ATTACKS) {
      it(`rejects: ${sql.slice(0, 60)}`, async () => {
        const result = await executeQueryDatabase(
          analystDb as PrismaClient,
          sql
        );
        expect(result.success, sql).toBe(false);
      });
    }

    it("still answers a legitimate query through the views", async () => {
      const result = await executeQueryDatabase(
        analystDb as PrismaClient,
        "SELECT COUNT(*) AS n FROM jobs"
      );
      expect(result.success).toBe(true);
      expect(result.data).toContain('"n":0');
    });
  }
);

maybeDescribe("executeGetSchema reads the analyst schema", () => {
  it("users shows the view's safe columns — never password", async () => {
    const result = await executeGetSchema(prisma as PrismaClient, "users");
    expect(result.success).toBe(true);
    const cols = JSON.parse(result.data).users.map(
      (c: { column_name: string }) => c.column_name
    );
    expect(cols).toEqual(["id", "name", "role", "createdAt"]);
    expect(cols).not.toContain("password");
    expect(cols).not.toContain("username");
    expect(cols).not.toContain("email");
  });
});

maybeDescribe("migration is non-fatal without CREATEROLE", () => {
  it("skips role creation with a NOTICE instead of aborting", async () => {
    // Runs LAST: drops analyst_ro so the DO-block takes the CREATE path,
    // then replays it as a role without CREATEROLE — must NOTICE-and-
    // continue, never abort. DROP OWNED clears the default-privileges
    // dependency the migration leaves behind.
    const limited = `it_norole_${Math.random().toString(36).slice(2, 8)}`;
    // The analystDb pool keeps idle sessions open as analyst_ro — kill
    // them or DROP ROLE fails with "role is in use".
    await need(pg).query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'analyst_ro'"
    );
    // Schema objects live in the test database — the revokes must run on
    // the testdb connection (pg), while role ops are cluster-global and
    // can go through either client.
    await need(pg).query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA analyst REVOKE SELECT ON TABLES FROM analyst_ro"
    );
    await need(pg).query(
      "REVOKE ALL ON ALL TABLES IN SCHEMA analyst FROM analyst_ro"
    );
    await need(pg).query("REVOKE ALL ON SCHEMA analyst FROM analyst_ro");
    await need(pg).query("DROP ROLE analyst_ro");
    await need(adminClient).query(
      `CREATE ROLE ${limited} NOLOGIN NOCREATEROLE`
    );
    await need(pg).query(`SET ROLE ${limited}`);
    try {
      const sql = readFileSync(
        join(
          process.cwd(),
          "prisma/migrations/20261117000000_ai_analyst_role/migration.sql"
        ),
        "utf8"
      );
      const doBlock = sql.slice(sql.indexOf("DO $analyst$"));
      await expect(need(pg).query(doBlock)).resolves.toBeTruthy();
    } finally {
      await need(pg).query("RESET ROLE");
      await need(adminClient).query(`DROP ROLE ${limited}`);
    }
    // The role must NOT have been created — the tool stays off.
    const roles = await need(pg).query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'analyst_ro'"
    );
    expect(roles.rowCount).toBe(0);
  });
});
