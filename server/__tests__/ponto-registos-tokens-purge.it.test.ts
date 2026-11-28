/**
 * Integration test: purga dos tokens REGISTOS na função SECURITY DEFINER
 * ponto_purge_expired() — mesmo harness de base de dados descartável de
 * ponto-act-export-consistency.it.test.ts (salta quando não há Postgres
 * acessível, corre sempre no CI).
 *
 * A regra (a): tokens usados há mais de 7 dias ou expirados há mais de 7
 * dias saem na purga diária; um token ainda vivo (por usar e dentro das
 * 24 h) nunca entra — é a única garantia de que o link prometido ao
 * trabalhador funciona.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = `ponto_purge_it_${process.pid}_${Math.random()
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
      "[ponto-purge-it] no PostgreSQL reachable — tests will skip:",
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
    console.error(`[ponto-purge-it] migrate output:\n${migrate.output}`);
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!serverReachable)(
  "purga dos tokens REGISTOS (integração)",
  () => {
    it("usados/expirados há 7+ dias saem; tokens vivos ficam", async () => {
      const db = getPrisma();
      const user = await db.user.create({
        data: {
          email: "purge-it@test.local",
          role: "OWNER",
          username: `purge-it-${Date.now()}`,
        },
      });

      const now = Date.now();
      const mk = (
        id: string,
        daysAgo: number | null,
        usedDaysAgo: number | null
      ) =>
        db.pontoRegistosToken.create({
          data: {
            // expiração: ou daqui a umas horas (vivo), ou há N dias
            expiresAt: new Date(
              daysAgo === null ? now + 20 * 3_600_000 : now - daysAgo * DAY_MS
            ),
            id,
            month: "2026-10",
            tokenHash: `hash-${id}`,
            usedAt:
              usedDaysAgo === null
                ? null
                : new Date(now - usedDaysAgo * DAY_MS),
            userId: user.id,
          },
        });

      // mortos há 7+ dias — têm de sair
      await mk("used-8d", null, 8); // usado há 8 dias
      await mk("expired-8d", 8, null); // expirado há 8 dias sem uso
      // vivos ou mortos há menos de 7 dias — ficam
      await mk("valid-open", null, null); // válido e por usar
      await mk("used-2d", null, 2); // usado há 2 dias (janela de auditoria)
      // usado há 6 dias embora a expiração fosse há 9 — a morte conta
      // pelo uso, não pela validade que tinha
      await mk("used-6d-exp-9d", 9, 6);
      // limite exato: morto há 6 dias e 23 horas — ainda dentro da janela
      await mk("used-just-inside", null, 6);

      await db.$queryRaw`SELECT ponto_purge_expired()`;

      const remaining = await db.pontoRegistosToken.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      });
      expect(remaining.map((r) => r.id)).toEqual([
        "used-2d",
        "used-6d-exp-9d",
        "used-just-inside",
        "valid-open",
      ]);
    });

    it("expirado há mais de 7 dias mas usado há menos de 7 fica — a morte é o uso", async () => {
      const db = getPrisma();
      const user = await db.user.create({
        data: {
          email: "purge-it2@test.local",
          role: "OWNER",
          username: `purge-it2-${Date.now()}`,
        },
      });
      const now = Date.now();
      await db.pontoRegistosToken.create({
        data: {
          expiresAt: new Date(now - 10 * DAY_MS), // expirou há 10 dias
          id: "exp-10d-used-3d",
          month: "2026-10",
          tokenHash: "hash-exp-10d-used-3d",
          usedAt: new Date(now - 3 * DAY_MS), // mas foi usado há 3
          userId: user.id,
        },
      });
      await db.$queryRaw`SELECT ponto_purge_expired()`;
      const remaining = await db.pontoRegistosToken.findMany({
        select: { id: true },
        where: { userId: user.id },
      });
      expect(remaining.map((r) => r.id)).toEqual(["exp-10d-used-3d"]);
    });
  }
);
