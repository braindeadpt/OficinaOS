/**
 * Integration test: the seed must produce notification templates whose
 * variables exactly match what the dispatch pipeline actually provides.
 * Run against a real, temporary PostgreSQL database.
 *
 * Setup (per file):
 *   1. connect to the local Postgres via DATABASE_URL;
 *   2. create a throwaway database (seed_it_<pid>_<rand>);
 *   3. apply every migration with `prisma migrate deploy` against it;
 *   4. run `bun run prisma/seed.ts` as a subprocess — the same code path
 *      as `bun run db:seed`.
 *
 * Assertions:
 *   - a WHATSAPP template exists for every dispatched event (a missing
 *     event is a hard failure so a seed regression can never pass);
 *   - every `{{var}}` and `{{if var}}` in every template is provided by
 *     the dispatcher (plus shopName, injected centrally by notify()) —
 *     no template may reference unknown variables;
 *   - every WHATSAPP and IN_APP template renders from the real dispatch
 *     context with no leftover `{{...}}` placeholders;
 *   - re-running the seed is idempotent (no duplicate template rows).
 *
 * Skipped gracefully when no PostgreSQL is reachable (local dev without
 * a server); the CI `check` job always provides one.
 */
import { spawn } from "node:child_process";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderTemplate } from "../services/notification-renderer.js";

// Dispatch context exactly as each emitter passes it to notify() — see
// the call sites in server/services and server/routes.
const DISPATCH_CONTEXT: Record<string, Record<string, string>> = {
  job_created: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_done: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_in_repair: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_waiting_parts: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_delivered: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_on_hold: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_returned: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_cancelled: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  job_overdue: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    recipientPhone: "+351910000001",
  },
  warranty_return_created: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0002",
    recipientPhone: "+351910000001",
  },
  quote_sent: {
    customerName: "Ana Silva",
    jobCode: "RPR-2026-0001",
    quoteAmount: "120.00",
    recipientPhone: "+351910000001",
  },
  // Owner-facing stock alert: no customer recipient yet.
  part_low_stock: {
    partName: "iPhone 15 screen",
    partQuantity: "2",
    partReorderLevel: "5",
  },
  return_claim_resolved: {
    jobCode: "RPR-2026-0001",
    outcome: "REFUNDED",
  },
};

// Events the seed must provide WHATSAPP templates for.
const REQUIRED_WHATSAPP_EVENTS = [
  "job_created",
  "job_done",
  "job_in_repair",
  "job_waiting_parts",
  "job_delivered",
  "job_on_hold",
  "job_returned",
  "job_cancelled",
  "job_overdue",
  "warranty_return_created",
  "part_low_stock",
  "quote_sent",
];

const PLACEHOLDER_RE = /\{\{[^}]*\}\}/g;
const VAR_NAME_RE = /\{\{(?:if\s+)?(\w+)\}\}/g;

const DB_NAME = `seed_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const baseUrl = process.env.DATABASE_URL as string;
const m = baseUrl.match(
  /^(postgresql:\/\/(?:[^/@:]+(?::[^/]*)?@)?[^/]+)\/([^?]+)(.*)$/
);
const adminUrl = m ? `${m[1]}/postgres${m[3] ?? ""}` : null;
const seedDbUrl = m ? `${m[1]}/${DB_NAME}${m[3] ?? ""}` : null;

let adminClient: Client | null = null;
let dbClient: Client | null = null;

/**
 * Probe the server once, at import time, so describe.skipIf stays static
 * and no test needs a runtime guard.
 */
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
      "[seed-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => {
      // probe teardown is best-effort; nothing to recover
    });
  }
}

const getDb = (): Client => {
  if (!dbClient) {
    throw new Error("integration db client missing — beforeAll failed?");
  }
  return dbClient;
};

/** Run a command, capturing output; resolve the exit code. */
const run = async (
  command: string,
  args: string[]
): Promise<{ code: number; output: string }> => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: seedDbUrl as string },
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
  if (!(adminUrl && seedDbUrl && serverReachable)) {
    return;
  }

  adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();

  await adminClient.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);

  const migrate = await run("bunx", ["prisma", "migrate", "deploy"]);
  if (migrate.code !== 0) {
    console.error(`[seed-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  const seed = await run("bun", ["run", "prisma/seed.ts"]);
  if (seed.code !== 0) {
    console.error(`[seed-it] seed output:\n${seed.output}`);
    throw new Error(`seed exited with ${seed.code}`);
  }

  dbClient = new Client({ connectionString: seedDbUrl });
  await dbClient.connect();
}, 120_000);

const teardownError = (label: string, err: unknown): void => {
  console.warn(`[seed-it] teardown ${label} failed:`, (err as Error).message);
};

afterAll(async () => {
  if (dbClient) {
    await dbClient.end().catch((err: unknown) => teardownError("end", err));
  }
  if (adminClient) {
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
      .catch((err: unknown) => teardownError("drop", err));
    await adminClient.end().catch((err: unknown) => teardownError("end", err));
  }
});

describe.skipIf(!serverReachable)(
  "seed WHATSAPP templates (integration)",
  () => {
    it("seeds a WHATSAPP template for every dispatched event", async () => {
      const res = await getDb().query(
        `SELECT name FROM notification_templates
         WHERE channel = 'WHATSAPP' ORDER BY name`
      );
      const names = res.rows.map((r: { name: string }) => r.name);
      const missing = REQUIRED_WHATSAPP_EVENTS.filter(
        (e) => !names.includes(e)
      );
      expect(missing).toEqual([]);
    });

    it("only references variables the dispatcher actually provides", async () => {
      const res = await getDb().query(
        "SELECT name, body FROM notification_templates ORDER BY name, channel"
      );

      const problems: string[] = [];
      for (const row of res.rows) {
        const provided = new Set([
          ...Object.keys(DISPATCH_CONTEXT[row.name] ?? {}),
          "shopName", // injected centrally by notify() since the shopName PR
          "trackingUrl", // injected centrally from ShopSettings.trackingBaseUrl
          "reviewUrl", // injected centrally from ShopSettings.reviewUrl
          "currency", // injected centrally from ShopSettings.currency
        ]);
        for (const match of row.body.matchAll(VAR_NAME_RE)) {
          // `{{endif}}` closes an {{if}} block — syntax, not a variable.
          if (match[1] === "endif") {
            continue;
          }
          if (!provided.has(match[1])) {
            problems.push(`[${row.name}] unknown variable {{${match[1]}}}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it("renders every WHATSAPP template with no leftover placeholders", async () => {
      const res = await getDb().query(
        `SELECT name, body FROM notification_templates WHERE channel = 'WHATSAPP'`
      );

      const problems: string[] = [];
      for (const row of res.rows) {
        const vars = DISPATCH_CONTEXT[row.name];
        if (!vars) {
          continue;
        }
        const variants: Record<string, string>[] = [
          { shopName: "Oficina Teste" },
          {},
        ];
        for (const extra of variants) {
          const rendered = renderTemplate(row.body, { ...vars, ...extra });
          if (PLACEHOLDER_RE.test(rendered)) {
            problems.push(`[${row.name}]: ${rendered}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it("renders IN_APP templates without leftover placeholders", async () => {
      const res = await getDb().query(
        `SELECT name, body FROM notification_templates WHERE channel = 'IN_APP'`
      );

      const problems: string[] = [];
      for (const row of res.rows) {
        const vars = DISPATCH_CONTEXT[row.name];
        if (!vars) {
          continue;
        }
        const rendered = renderTemplate(row.body, vars);
        if (PLACEHOLDER_RE.test(rendered)) {
          problems.push(`[${row.name}]: ${rendered}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it("re-runs the seed idempotently (no duplicate templates)", async () => {
      const rerun = await run("bun", ["run", "prisma/seed.ts"]);
      if (rerun.code !== 0) {
        console.error(`[seed-it] rerun output:\n${rerun.output}`);
      }
      expect(rerun.code).toBe(0);

      const res = await getDb().query(
        `SELECT name, channel, count(*)::int AS n
         FROM notification_templates
         GROUP BY name, channel HAVING count(*) > 1`
      );
      expect(res.rows).toEqual([]);
    });
  }
);
