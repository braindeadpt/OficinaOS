// Failed-lookup lockout shared by the public tracking endpoints
// (/api/jobs/lookup, /lookup-receipt and /api/public/quote-respond): five
// misses on one job code block further guesses on it for an hour, enough to
// make enumerating phone suffixes impractical.
//
// State lives in the `code_lockouts` table so a server restart does not reset
// the counters.
import type { DbClient } from "../repositories/types.js";

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 60 * 60 * 1000;
// Below-threshold failures only count within a rolling window — the previous
// in-memory map aged them out every 15 minutes.
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export interface CodeLockoutStore {
  clear(code: string): Promise<void>;
  isLocked(code: string): Promise<boolean>;
  trackFailure(code: string): Promise<void>;
}

export function createCodeLockout(prisma: DbClient): CodeLockoutStore {
  return {
    async clear(code) {
      await prisma.codeLockout.deleteMany({ where: { code } });
    },
    async isLocked(code) {
      const lockout = await prisma.codeLockout.findUnique({ where: { code } });
      if (!lockout?.lockedUntil) {
        return false;
      }
      if (lockout.lockedUntil.getTime() > Date.now()) {
        return true;
      }
      // Expired lock: drop the row so the code starts from a clean slate.
      await prisma.codeLockout.deleteMany({ where: { code } });
      return false;
    },
    async trackFailure(code) {
      const now = Date.now();
      const existing = await prisma.codeLockout.findUnique({
        where: { code },
      });
      const lockExpired =
        existing?.lockedUntil && existing.lockedUntil.getTime() <= now;
      const windowExpired =
        existing && now - existing.firstFailedAt.getTime() > FAILURE_WINDOW_MS;
      const reset = !existing || lockExpired || windowExpired;

      // Atomic upsert: concurrent failures never lose increments.
      const row = await prisma.codeLockout.upsert({
        where: { code },
        create: { code, failures: 1 },
        update: reset
          ? { failures: 1, firstFailedAt: new Date(now), lockedUntil: null }
          : { failures: { increment: 1 } },
      });

      if (
        row.failures >= LOCKOUT_THRESHOLD &&
        !(row.lockedUntil && row.lockedUntil.getTime() > now)
      ) {
        await prisma.codeLockout.update({
          where: { code },
          data: { lockedUntil: new Date(now + LOCKOUT_DURATION_MS) },
        });
      }
    },
  };
}
