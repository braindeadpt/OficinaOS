/**
 * Integration test: the bundled device catalog sync against a real,
 * temporary PostgreSQL database — first run upserts brands/models and
 * stamps shop_settings.deviceCatalogVersion; a second run is skipped;
 * shop-created rows survive untouched.
 *
 * Same harness as demo-reset.test.ts: throwaway database,
 * `prisma migrate deploy`, skipped when no PostgreSQL is reachable.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEVICE_CATALOG_VERSION,
  syncDeviceCatalogIfStale,
} from "../services/device-catalog.service.js";

const DB_NAME = `devcat_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

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
      "[device-catalog-it] no PostgreSQL reachable — tests will skip:",
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
    console.error(`[device-catalog-it] migrate output:\n${migrate.output}`);
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

describe.skipIf(!serverReachable)("device catalog sync (integration)", () => {
  it("upserts the bundled catalog and stamps the version", async () => {
    const db = getPrisma();
    const result = await syncDeviceCatalogIfStale(db);

    expect(result.skipped).toBe(false);
    expect(result.brands).toBeGreaterThan(0);
    expect(result.devicesCreated).toBeGreaterThan(1000);

    const apple = await db.brand.findUnique({
      where: { name: "Apple" },
      include: { devices: { where: { model: "iPhone 16" } } },
    });
    expect(apple).not.toBeNull();
    expect(apple?.devices[0]?.category).toBe("phone");

    // Computer brands from the curated list are present too.
    const dell = await db.brand.findUnique({
      where: { name: "Dell" },
      include: { devices: { where: { model: "Latitude 7440" } } },
    });
    expect(dell?.devices[0]?.category).toBe("laptop");

    const settings = await db.shopSettings.findFirstOrThrow();
    expect(settings.deviceCatalogVersion).toBe(DEVICE_CATALOG_VERSION);
  }, 120_000);

  it("is a no-op once the version is current", async () => {
    const db = getPrisma();
    const result = await syncDeviceCatalogIfStale(db);

    expect(result).toEqual({
      brands: 0,
      devicesCreated: 0,
      devicesUpdated: 0,
      skipped: true,
    });
  });

  it("merges catalog brands case-insensitively into existing rows", async () => {
    const db = getPrisma();
    // Simulate a pre-upgrade DB: the catalog already synced "vivo", but an
    // older install had seeded "Vivo" — rename to that casing, rewind the
    // version stamp and re-sync as an upgrade would.
    await db.brand.update({
      data: { name: "Vivo" },
      where: { name: "vivo" },
    });
    await db.shopSettings.updateMany({
      data: { deviceCatalogVersion: 0 },
    });
    await syncDeviceCatalogIfStale(db);

    const vivoBrands = await db.brand.findMany({
      where: { name: { contains: "vivo", mode: "insensitive" } },
    });
    expect(vivoBrands).toHaveLength(1);
    expect(vivoBrands[0]?.name).toBe("Vivo");

    // Catalog models are still attached to that same brand.
    const deviceCount = await db.device.count({
      where: { brandId: vivoBrands[0]?.id },
    });
    expect(deviceCount).toBeGreaterThan(30);

    await db.shopSettings.updateMany({
      data: { deviceCatalogVersion: DEVICE_CATALOG_VERSION },
    });
  }, 120_000);

  it("never deletes shop-created brands or models", async () => {
    const db = getPrisma();
    const custom = await db.brand.create({ data: { name: "Marca Local" } });
    await db.device.create({
      data: {
        brandId: custom.id,
        category: "phone",
        model: "Modelo Armazém",
      },
    });
    // Re-run after resetting the version stamp, as a catalog upgrade would.
    await db.shopSettings.updateMany({
      data: { deviceCatalogVersion: 0 },
    });
    const result = await syncDeviceCatalogIfStale(db);
    expect(result.skipped).toBe(false);

    const stillThere = await db.device.findFirst({
      where: { brandId: custom.id, model: "Modelo Armazém" },
    });
    expect(stillThere).not.toBeNull();
    expect(await db.brand.count({ where: { name: "Marca Local" } })).toBe(1);

    // Restore the stamp so test order doesn't matter.
    await db.shopSettings.updateMany({
      data: { deviceCatalogVersion: DEVICE_CATALOG_VERSION },
    });
  }, 120_000);
});
