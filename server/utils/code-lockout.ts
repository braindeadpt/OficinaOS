// Failed-lookup lockout shared by the public tracking endpoints
// (/api/jobs/lookup and /api/public/quote-respond): five misses on one job
// code block further guesses on it for an hour, enough to make enumerating
// phone suffixes impractical.
//
// NOTE: This is per-process state — it will NOT be shared across multiple
// server instances. For OficinaOS's single-location deployment (one server)
// this is acceptable. If multi-instance deployment is ever needed, this
// should be replaced with a Redis or DB-backed store.
// TODO: Migrate to Redis/DB-backed store for multi-instance support.
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 60 * 60 * 1000;

interface LockoutEntry {
  failures: number;
  lockedUntil: number;
}

export interface CodeLockoutStore {
  clear(code: string): void;
  isLocked(code: string): boolean;
  trackFailure(code: string): void;
}

export function createCodeLockout(): CodeLockoutStore {
  const lockouts = new Map<string, LockoutEntry>();

  const cleanupInterval = setInterval(
    () => {
      const now = Date.now();
      for (const [key, val] of lockouts) {
        // Expired locks and still-unlocked failures both age out: keeping the
        // latter forever would let one abandoned code pin memory indefinitely.
        if (val.lockedUntil <= now) {
          lockouts.delete(key);
        }
      }
    },
    15 * 60 * 1000
  );
  // Prevent cleanup from keeping the process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return {
    clear(code) {
      lockouts.delete(code);
    },
    isLocked(code) {
      const lockout = lockouts.get(code);
      if (lockout && lockout.lockedUntil > Date.now()) {
        return true;
      }
      if (lockout?.lockedUntil && lockout.lockedUntil <= Date.now()) {
        lockouts.delete(code);
      }
      return false;
    },
    trackFailure(code) {
      const existing = lockouts.get(code) ?? { failures: 0, lockedUntil: 0 };
      existing.failures += 1;
      if (existing.failures >= LOCKOUT_THRESHOLD) {
        existing.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
      }
      lockouts.set(code, existing);
    },
  };
}

// Shared instance so misses on /api/jobs/lookup and /api/public/quote-respond
// count against the same per-code budget. Tests should create fresh stores
// via createCodeLockout() instead of importing this.
export const codeLockout = createCodeLockout();
