import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

const ANALYST_ROLE = "analyst_ro";

let cached: Promise<PrismaClient | null> | null = null;

/**
 * Dedicated connection for the AI SQL tool, built from
 * ANALYST_DATABASE_URL. The session_user there IS analyst_ro — a login
 * role that belongs to nothing else — so `set_config('role', …)` inside a
 * query can never escalate back to the shop owner the way
 * `SET LOCAL ROLE` on the app connection could.
 *
 * Returns null when the URL is unset or does not resolve to analyst_ro:
 * the tool then fails closed instead of falling back to a privileged
 * connection or to regex-only validation.
 */
async function buildClient(): Promise<PrismaClient | null> {
  const url = loadEnv().ANALYST_DATABASE_URL;
  if (!url) {
    return null;
  }
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const rows = await client.$queryRawUnsafe<{ session_user: string }[]>(
      "SELECT session_user"
    );
    if (rows[0]?.session_user !== ANALYST_ROLE) {
      logger.error(
        { sessionUser: rows[0]?.session_user },
        "ANALYST_DATABASE_URL must authenticate as analyst_ro — refusing to run AI SQL on a privileged role"
      );
      await client.$disconnect();
      return null;
    }
    return client;
  } catch (err) {
    logger.warn({ err }, "analyst DB connection failed — AI SQL tool disabled");
    await client.$disconnect().catch(() => undefined);
    return null;
  }
}

export function getAnalystClient(): Promise<PrismaClient | null> {
  cached ??= buildClient();
  return cached;
}

/** Test hook — drops the cached client so env changes are picked up. */
export async function resetAnalystClientForTests(): Promise<void> {
  const client = await cached;
  cached = null;
  await client?.$disconnect().catch(() => undefined);
}
