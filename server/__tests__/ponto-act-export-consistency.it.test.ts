/**
 * Integration test: ACT export read consistency against a real PostgreSQL
 * database (same throwaway-database harness as
 * delivery-payment-atomicity.test.ts — skipped when no PostgreSQL is
 * reachable, always runs in CI).
 *
 * A punch inserted mid-export must never appear partially: either the
 * snapshot includes it fully (rows AND totals) or not at all. The insert
 * is forced inside the export transaction by wrapping $transaction, and a
 * second direct connection writes the late pair — the invariant has to
 * hold whichever side of the snapshot it lands on.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPontoActExport } from "../services/ponto-act-export.service.js";

const DB_NAME = `ponto_act_it_${process.pid}_${Math.random()
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
      "[ponto-act-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => undefined);
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
    console.error(`[ponto-act-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDbUrl }),
  });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect().catch(() => undefined);
  }
  if (adminClient) {
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME}"`)
      .catch(() => undefined);
    await adminClient.end().catch(() => undefined);
  }
});

const getPrisma = (): PrismaClient => {
  if (!prisma) {
    throw new Error("integration prisma client missing — beforeAll failed?");
  }
  return prisma;
};

const RANGE = {
  end: new Date("2026-01-06T00:00:00.000Z"),
  fromDate: "2026-01-05",
  start: new Date("2026-01-05T00:00:00.000Z"),
  toDate: "2026-01-05",
};

function punch(
  userId: string,
  type: "ENTRADA" | "SAIDA",
  iso: string,
  id: string
) {
  return {
    at: new Date(iso),
    id,
    proofs: {},
    status: "APROVADO" as const,
    transport: "MANUAL" as const,
    type,
    userId,
  };
}

describe.skipIf(!serverReachable)(
  "exportação ACT — consistência transacional (integração)",
  () => {
    it("picagem inserida a meio da exportação nunca aparece parcialmente", async () => {
      const db = getPrisma();
      const owner = await db.user.create({
        data: {
          email: "dono@it.test",
          role: "OWNER",
          username: "dono-it",
        },
      });
      const worker = await db.user.create({
        data: {
          email: "ana@it.test",
          pontoEnabled: true,
          role: "TECHNICIAN",
          username: "ana-it",
        },
      });
      await db.shopSettings.create({ data: { id: "default" } });
      await db.timeEntry.createMany({
        data: [
          punch(worker.id, "ENTRADA", "2026-01-05T09:00:00.000Z", "base-in"),
          punch(worker.id, "SAIDA", "2026-01-05T17:00:00.000Z", "base-out"),
        ],
      });

      // Par tardio inserido por uma segunda ligação DENTRO da transação da
      // exportação — antes ou depois do snapshot, a invariante é a mesma.
      const lateRows = [
        punch(worker.id, "ENTRADA", "2026-01-05T18:00:00.000Z", "late-in"),
        punch(worker.id, "SAIDA", "2026-01-05T19:00:00.000Z", "late-out"),
      ];
      const writer = new Client({ connectionString: testDbUrl as string });
      await writer.connect();
      const insertLate = async () => {
        for (const row of lateRows) {
          await writer.query(
            `INSERT INTO "time_entries" ("id", "userId", "type", "at", "transport", "status", "proofs", "createdAt")
             VALUES ($1, $2, $3::"TimeEntryType", $4, $5::"TimeEntryTransport", $6::"TimeEntryStatus", $7, now())
             ON CONFLICT ("id") DO NOTHING`,
            [
              row.id,
              row.userId,
              row.type,
              row.at.toISOString(),
              row.transport,
              row.status,
              JSON.stringify(row.proofs),
            ]
          );
        }
      };

      // Envolve o cliente real: a escrita concorrente acontece dentro da
      // transação da exportação, garantidamente a meio das suas leituras.
      const originalTransaction = db.$transaction.bind(db);
      const spyPrisma = Object.create(db) as PrismaClient;
      spyPrisma.$transaction = ((
        callback: (tx: unknown) => Promise<unknown>,
        options?: unknown
      ) =>
        originalTransaction(
          (async (tx: unknown) => {
            // Uma leitura dentro da transação ANTES da escrita concorrente:
            // em RepeatableRead o snapshot é fixado na primeira leitura —
            // o par tardio escrito depois disto é invisível para todas as
            // leituras seguintes. Com ReadCommitted apareceria nas linhas
            // da exportação e o teste falharia, ou seja, deixa de ser
            // possível passar sem o isolamento exigido.
            await (tx as PrismaClient).shopSettings.findFirst();
            await insertLate();
            return callback(tx);
          }) as never,
          options as never
        )) as never;

      try {
        const out = await getPontoActExport(
          spyPrisma,
          { actorId: owner.id, range: RANGE, tz: "Europe/Lisbon" },
          new Date("2026-01-10T12:00:00.000Z")
        );
        const w = out.workers.find((x) => x.username === "ana-it");
        const day = w?.days.find((d) => d.date === "2026-01-05");
        const ids = day?.entries.map((e) => e.id) ?? [];
        const includesLate = ids.includes("late-in");

        // RepeatableRead fixa o snapshot na primeira leitura da transação —
        // anterior à escrita concorrente — por isso o par tardio NUNCA pode
        // aparecer. Aceitar a presença dele equivaleria ao comportamento de
        // ReadCommitted e o teste deixaria de distinguir os dois níveis.
        expect(includesLate).toBe(false);
        expect(ids.includes("late-out")).toBe(false);
        expect(day?.workedMinutes).toBe(480);
        expect(w?.totalMinutes).toBe(480);
      } finally {
        await writer.end().catch(() => undefined);
      }
    }, 60_000);
  }
);
