/**
 * Integration test: upgrading from the short-lived WarnedAt semantics must
 * not carry the old warning timestamp into StartedAt. The migration NULLs the
 * renamed column so the first boot of this version starts the full 30-day
 * transition. Uses the same throwaway-database harness as the other migration
 * tests and skips when no PostgreSQL is reachable.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stampWhatsAppLocalDeprecationStartedAtOnce } from "../services/settings.service.js";

const DB_NAME = `wadep_it_${process.pid}_${Math.random()
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
      "[wadep-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => {
      // best-effort probe teardown
    });
  }
}

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
    console.error(`[wadep-it] migrate output:\n${migrate.output}`);
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

describe.skipIf(!serverReachable)(
  "whatsapp deprecation migration (integration)",
  () => {
    it("clears the old warning date so boot starts the full transition", async () => {
      const db = prisma as PrismaClient;
      const sql = pg as Client;
      const oldWarningAt = new Date("2020-01-01T00:00:00.000Z");
      await db.shopSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          whatsappLocalDeprecationStartedAt: oldWarningAt,
        },
        update: { whatsappLocalDeprecationStartedAt: oldWarningAt },
      });

      // Reverte apenas a coluna para o estado pré-correção — com a data antiga
      // dentro de WarnedAt — e aplica o ficheiro de migração completo, verbatim.
      // Assim o teste cobre o upgrade real (RENAME preserva + UPDATE limpa), não
      // apenas uma instrução SQL copiada para fora de contexto.
      await sql.query(
        'ALTER TABLE "shop_settings" RENAME COLUMN "whatsappLocalDeprecationStartedAt" TO "whatsappLocalDeprecationWarnedAt"'
      );
      const migrationSql = readFileSync(
        join(
          process.cwd(),
          "prisma/migrations/20261231191000_whatsapp_deprecation_started_at/migration.sql"
        ),
        "utf8"
      );
      await sql.query(migrationSql);

      const cleared = await db.shopSettings.findUniqueOrThrow({
        where: { id: "default" },
      });
      expect(cleared.whatsappLocalDeprecationStartedAt).toBeNull();

      const startedAt = await stampWhatsAppLocalDeprecationStartedAtOnce(db);
      const stamped = await db.shopSettings.findUniqueOrThrow({
        where: { id: "default" },
      });
      expect(startedAt.getTime()).toBeGreaterThan(oldWarningAt.getTime());
      expect(stamped.whatsappLocalDeprecationStartedAt?.getTime()).toBe(
        startedAt.getTime()
      );
    });
  }
);
