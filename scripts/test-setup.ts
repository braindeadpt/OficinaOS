#!/usr/bin/env bun
/**
 * One-time setup so `bun run test` works on a fresh clone.
 *
 * The unit tests never touch a real database (vitest.setup.ts fills in
 * placeholder env vars), but they do import the generated Prisma client,
 * and `prisma generate` refuses to run without DATABASE_URL (see
 * prisma.config.ts). This script supplies a placeholder URL when neither
 * the environment nor `.env` provides one, then generates the client.
 */

import { spawnSync } from "node:child_process";
import { readEnvFile } from "../server/config/env-file";

const PLACEHOLDER_DATABASE_URL = "postgresql://test:test@localhost:5432/test";

readEnvFile();

const env = { ...process.env };
if (!env.DATABASE_URL) {
  env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
  process.stdout.write(
    "DATABASE_URL not set — using a placeholder (prisma generate does not connect).\n"
  );
}

process.stdout.write("-> Generating Prisma client: bunx prisma generate\n");
const result = spawnSync("bunx", ["prisma", "generate"], {
  cwd: process.cwd(),
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write("Test setup complete — run `bun run test`.\n");
