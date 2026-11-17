import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "../utils/logger.js";
import { analystDatabaseUrl, analystRoleName } from "./analyst-provision.js";

const RETRY_BACKOFF_MS = 30_000;

// Só o sucesso é cacheado: um null de falha transitória (BD ainda a
// arrancar no boot) não pode desligar a tool até ao próximo restart.
let cached: Promise<PrismaClient | null> | null = null;
let nextAttemptAt = 0;
// URL que autentica outro role é configuração errada, não falha
// transitória — recusa permanente, sem retentar a cada pedido.
let refusedWrongRole = false;

/**
 * Dedicated connection for the AI SQL tool. The session_user there IS
 * analyst_ro_<db>_<hash> — a login role that belongs to nothing else — so
 * `set_config('role', …)` inside a query can never escalate back to the
 * shop owner the way `SET LOCAL ROLE` on the app connection could.
 *
 * Returns null when the URL is unset/unprovisioned, unreachable, or
 * authenticates the wrong role: the tool then fails closed instead of
 * falling back to a privileged connection or to regex-only validation.
 */
async function buildClient(): Promise<PrismaClient | null> {
  const url = analystDatabaseUrl();
  if (!url) {
    return null;
  }
  const expected = analystRoleName(
    decodeURIComponent(new URL(url).pathname.slice(1))
  );
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const rows = await client.$queryRawUnsafe<{ session_user: string }[]>(
      "SELECT session_user"
    );
    if (rows[0]?.session_user !== expected) {
      logger.error(
        { sessionUser: rows[0]?.session_user },
        `analyst connection must authenticate as ${expected} — refusing to run AI SQL on a privileged role`
      );
      refusedWrongRole = true;
      await client.$disconnect();
      return null;
    }
    return client;
  } catch (err) {
    logger.warn({ err }, "analyst DB connection failed — AI SQL tool disabled");
    nextAttemptAt = Date.now() + RETRY_BACKOFF_MS;
    await client.$disconnect().catch(() => undefined);
    return null;
  }
}

export function getAnalystClient(): Promise<PrismaClient | null> {
  if (refusedWrongRole || Date.now() < nextAttemptAt) {
    return Promise.resolve(null);
  }
  cached ??= buildClient().then((client) => {
    if (client === null) {
      cached = null; // falha transitória — retenta no próximo pedido
    }
    return client;
  });
  return cached;
}

/** Test hook — drops the cached client so env changes are picked up. */
export async function resetAnalystClientForTests(): Promise<void> {
  const client = await cached;
  cached = null;
  refusedWrongRole = false;
  nextAttemptAt = 0;
  await client?.$disconnect().catch(() => undefined);
}

/** Test hook — torna o backoff/refusal observáveis sem tocar na BD. */
export function analystClientDebugState(): {
  refusedWrongRole: boolean;
  nextAttemptAt: number;
} {
  return { refusedWrongRole, nextAttemptAt };
}
