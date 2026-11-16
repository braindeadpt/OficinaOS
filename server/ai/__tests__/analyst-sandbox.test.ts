/**
 * Integration test — the AI analyst SQL sandbox (schema `analyst` + role
 * `analyst_ro_<db>` on a dedicated connection). Asserts the Postgres
 * layer — not the regexes — is what stops the attacks from the security
 * finding: derived tables, TABLE-expressions, schema-qualified reads,
 * pg_authid and the set_config('role', …) session_user escape.
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
import { analystRoleName } from "../analyst-provision.js";
import {
  ALLOWED_TABLES,
  BLOCKED_COLUMNS,
  executeGetSchema,
  executeQueryDatabase,
} from "../tools.js";

const DB_NAME = `analyst_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const DB_NAME_B = `${DB_NAME}_b`;
const ANALYST_PASSWORD = "analyst_it_pw";
const ROLE = analystRoleName(DB_NAME);
const ROLE_B = analystRoleName(DB_NAME_B);

const baseUrl = process.env.DATABASE_URL as string;
const m = baseUrl.match(
  /^(postgresql:\/\/(?:[^/@:]+(?::[^/]*)?@)?[^/]+)\/([^?]+)(.*)$/
);
const adminUrl = m ? `${m[1]}/postgres${m[3] ?? ""}` : null;
const testDbUrl = m ? `${m[1]}/${DB_NAME}${m[3] ?? ""}` : null;
const testDbUrlB = m ? `${m[1]}/${DB_NAME_B}${m[3] ?? ""}` : null;
const analystDbUrl = testDbUrl?.replace(
  /^postgresql:\/\/[^/@]*@/,
  `postgresql://${ROLE}:${ANALYST_PASSWORD}@`
);
const bUrlAsB = testDbUrlB?.replace(
  /^postgresql:\/\/[^/@]*@/,
  `postgresql://${ROLE_B}:${ANALYST_PASSWORD}@`
);
// Role de A ligado à BD de B — autentica, mas não deve ler nada.
const bUrlAsA = testDbUrlB?.replace(
  /^postgresql:\/\/[^/@]*@/,
  `postgresql://${ROLE}:${ANALYST_PASSWORD}@`
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
  args: string[],
  dbUrl: string
): Promise<{ code: number; output: string }> => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl },
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

  const migrate = await run("bunx", ["prisma", "migrate", "deploy"], testDbUrl);
  if (migrate.code !== 0) {
    console.error(`[analyst-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  // Provision the role's login — ensureAnalystProvisioned does this on
  // real installs; here it is a one-liner on the throwaway cluster.
  await adminClient.query(
    `ALTER ROLE "${ROLE}" WITH LOGIN PASSWORD '${ANALYST_PASSWORD}'`
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
  if (adminClient && testDbUrl) {
    // pg_shdepend é global ao cluster: antes de DROP DATABASE/DROP ROLE,
    // os objetos do role (grants, default privileges) têm de sair — só se
    // limpa dentro da própria BD, por isso o DROP OWNED corre lá dentro.
    const cleaner = new Client({ connectionString: testDbUrl });
    await cleaner.connect().catch(() => undefined);
    await cleaner
      .query(`REASSIGN OWNED BY "${ROLE}" TO CURRENT_USER`)
      .catch(() => undefined);
    await cleaner.query(`DROP OWNED BY "${ROLE}"`).catch(() => undefined);
    await cleaner.end().catch(() => undefined);
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
      .catch(() => undefined);
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME_B}" WITH (FORCE)`)
      .catch(() => undefined);
    await adminClient
      .query(`DROP ROLE IF EXISTS "${ROLE}"`)
      .catch(() => undefined);
    await adminClient
      .query(`DROP ROLE IF EXISTS "${ROLE_B}"`)
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

  it("analyst_ro_<db> can LOGIN and read only the analyst schema", async () => {
    const who = await need(analystDb).$queryRawUnsafe<{ u: string }[]>(
      "SELECT session_user AS u"
    );
    expect(who[0]?.u).toBe(ROLE);
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
    // would resolve to public.jobs — where the role has no grant — and
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
      // set_config session_user escape — the role belongs to nothing, so
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

maybeDescribe("getAnalystClient — refusal permanente", () => {
  it("a URL que autentica outro role é recusada para sempre", async () => {
    // ANALYST_DATABASE_URL apontando para o user admin (reparilo): a
    // ligação funciona mas o session_user não é analyst_ro_<db> — a tool
    // recusa permanentemente, sem queda para a ligação privilegiada.
    const { resetEnvForTests } = await import("../../config/env.js");
    const {
      getAnalystClient,
      resetAnalystClientForTests,
      analystClientDebugState,
    } = await import("../analyst-client.js");
    const saved = process.env.ANALYST_DATABASE_URL;
    try {
      process.env.ANALYST_DATABASE_URL = testDbUrl as string;
      resetEnvForTests();
      await resetAnalystClientForTests();
      expect(await getAnalystClient()).toBeNull();
      expect(analystClientDebugState().refusedWrongRole).toBe(true);
      // Recusa permanente: sem retentativas — resolve null de imediato.
      expect(await getAnalystClient()).toBeNull();
    } finally {
      if (saved === undefined) {
        delete process.env.ANALYST_DATABASE_URL;
      } else {
        process.env.ANALYST_DATABASE_URL = saved;
      }
      resetEnvForTests();
      await resetAnalystClientForTests();
    }
  });
});

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

maybeDescribe("cluster isolation — role is per-database", () => {
  it("the role of DB A cannot read the analyst views of DB B", async () => {
    // Segunda BD no mesmo cluster: migração cria analyst_ro_<b> — o role
    // de A consegue LIGAR-SE a B (CONNECT vem de PUBLIC) mas não lê as
    // views de B nem as tabelas públicas.
    await need(adminClient).query(`DROP DATABASE IF EXISTS "${DB_NAME_B}"`);
    await need(adminClient).query(`CREATE DATABASE "${DB_NAME_B}"`);
    const migrate = await run(
      "bunx",
      ["prisma", "migrate", "deploy"],
      testDbUrlB as string
    );
    if (migrate.code !== 0) {
      throw new Error(`migrate B falhou:\n${migrate.output}`);
    }
    await need(adminClient).query(
      `ALTER ROLE "${ROLE_B}" WITH LOGIN PASSWORD '${ANALYST_PASSWORD}'`
    );

    // O role de B lê as views de B (sanidade do provisioning).
    const bAsB = new PrismaClient({
      adapter: new PrismaPg({ connectionString: bUrlAsB }),
    });
    const okB = await bAsB.$queryRawUnsafe<{ n: number }[]>(
      "SELECT COUNT(*)::int AS n FROM analyst.jobs"
    );
    expect(okB[0]?.n).toBe(0);
    await bAsB.$disconnect().catch(() => undefined);

    // O role de A ligado a B: conecta (PUBLIC dá CONNECT) mas não lê.
    const aInB = new PrismaClient({
      adapter: new PrismaPg({ connectionString: bUrlAsA }),
    });
    try {
      const who = await aInB.$queryRawUnsafe<{ u: string }[]>(
        "SELECT session_user AS u"
      );
      expect(who[0]?.u).toBe(ROLE);
      await expect(
        aInB.$queryRawUnsafe("SELECT * FROM analyst.jobs LIMIT 1")
      ).rejects.toThrow();
      await expect(
        aInB.$queryRawUnsafe("SELECT id FROM public.jobs LIMIT 1")
      ).rejects.toThrow();
    } finally {
      await aInB.$disconnect().catch(() => undefined);
    }
  }, 120_000);
});

maybeDescribe("migration is non-fatal without CREATEROLE", () => {
  it("skips role creation with a NOTICE instead of aborting", async () => {
    // Runs LAST: drops the role so the DO-block takes the CREATE path,
    // then replays it as a role without CREATEROLE — must NOTICE-and-
    // continue, never abort. Grants/default-privileges são objetos do
    // role nesta BD — DROP OWNED limpa-os (pg_shdepend é do cluster).
    const limited = `it_norole_${Math.random().toString(36).slice(2, 8)}`;
    // O pool do analystDb mantém sessões idle como o role — mata-as ou
    // DROP ROLE falha com "role is in use".
    await need(pg).query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
      [ROLE]
    );
    await need(pg).query(`DROP OWNED BY "${ROLE}"`);
    await need(pg).query(`DROP ROLE "${ROLE}"`);
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
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [ROLE]
    );
    expect(roles.rowCount).toBe(0);
  });
});
