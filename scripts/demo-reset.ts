/**
 * demo-reset — hourly reset for the public demo (DEMO_MODE).
 *
 * Rebuilds the deterministic dump (fresh "now" so dates stay alive),
 * truncates every public table and replays it, then clears the uploads
 * dir. Runs inside the app container — the infra timer calls it via
 * `docker exec demo-web bun run demo:reset`. The app keeps serving during
 * the whole run; the truncate+replay is one short transaction window.
 * Idempotent: safe to run repeatedly, and regenerates the snapshot if the
 * file went missing.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";
import { seedDemo } from "../prisma/seed-demo.js";
import { loadEnv } from "../server/config/env.js";

async function clearUploads(uploadDir: string): Promise<void> {
  const dir = path.resolve(uploadDir);
  await rm(dir, { recursive: true, force: true });
  await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
}

async function main() {
  const env = loadEnv();
  if (!env.DEMO_MODE) {
    throw new Error("demo:reset only runs with DEMO_MODE=true — it wipes the DB.");
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const dump = await seedDemo(prisma as never);
    const total = dump.reduce((s, [, rows]) => s + rows.length, 0);
    await clearUploads(env.UPLOAD_DIR);
    console.log(
      `demo reset ok — ${total} rows restored, uploads cleared (${env.UPLOAD_DIR})`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
