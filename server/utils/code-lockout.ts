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
      const expired =
        existing?.lockedUntil && existing.lockedUntil.getTime() <= now;
      const failures = expired ? 1 : (existing?.failures ?? 0) + 1;
      let lockedUntil = existing?.lockedUntil ?? null;
      if (failures >= LOCKOUT_THRESHOLD) {
        lockedUntil = new Date(now + LOCKOUT_DURATION_MS);
      } else if (expired) {
        lockedUntil = null;
      }
      await prisma.codeLockout.upsert({
        where: { code },
        create: { code, failures, lockedUntil },
        update: { failures, lockedUntil },
      });
    },
  };
}
