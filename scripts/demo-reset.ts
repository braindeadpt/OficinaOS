/**
 * demo-reset — hourly reset for the public demo (DEMO_MODE).
 *
 * Rebuilds the deterministic dump (fresh "now" so dates stay alive),
 * truncates every public table and replays it in ONE transaction, then
 * clears the uploads dir contents. Runs inside the app container — the
 * infra timer calls it via `docker exec demo-web bun run demo:reset`.
 * The app keeps serving during the whole run; readers either see the
 * pre- or post-reset state, never a half-empty database.
 * Idempotent: safe to run repeatedly.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";
import { seedDemo } from "../prisma/seed-demo.js";
import { loadEnv } from "../server/config/env.js";
import { assertDemoDatabase } from "../server/lib/demo.js";

/**
 * Deletes the CONTENTS of the uploads dir — never the dir itself, which
 * is the Docker volume mount point (rm'ing it fails with EBUSY and, if
 * it ever succeeded, the mount would be gone for good).
 * Refuses paths that could hurt more than the uploads volume: the
 * filesystem root, the process cwd, or any dir not literally named
 * "uploads".
 */
async function clearUploads(uploadDir: string): Promise<void> {
  const dir = path.resolve(uploadDir);
  if (
    dir === path.parse(dir).root ||
    dir === process.cwd() ||
    path.basename(dir) !== "uploads"
  ) {
    throw new Error(`refusing to clear unsafe upload dir "${dir}"`);
  }
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

async function main() {
  const env = loadEnv();
  if (!env.DEMO_MODE) {
    throw new Error(
      "demo:reset only runs with DEMO_MODE=true — it wipes the DB."
    );
  }
  // Second guard: never wipe a database whose name doesn't say "demo".
  assertDemoDatabase(env.DATABASE_URL);
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
