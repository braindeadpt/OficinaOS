import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCodeLockout,
  FAILURE_WINDOW_MS,
  LOCKOUT_THRESHOLD,
} from "../utils/code-lockout.js";

interface Row {
  code: string;
  failures: number;
  firstFailedAt: Date;
  lockedUntil: Date | null;
}

function fakePrisma() {
  const rows = new Map<string, Row>();
  return {
    codeLockout: {
      findUnique: vi.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(rows.get(where.code) ?? null)
      ),
      deleteMany: vi.fn(({ where }: { where: { code: string } }) => {
        rows.delete(where.code);
        return Promise.resolve({ count: 1 });
      }),
      updateMany: vi.fn(
        ({ where, data }: { where: { code: string }; data: Partial<Row> }) => {
          const existing = rows.get(where.code);
          if (existing) {
            rows.set(where.code, { ...existing, ...data });
          }
          return Promise.resolve({ count: existing ? 1 : 0 });
        }
      ),
      update: vi.fn(
        ({ where, data }: { where: { code: string }; data: Partial<Row> }) => {
          const existing = rows.get(where.code);
          if (existing) {
            rows.set(where.code, { ...existing, ...data });
          }
          return Promise.resolve(rows.get(where.code) ?? null);
        }
      ),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { code: string };
          create: Row;
          update: Partial<Row>;
        }) => {
          const existing = rows.get(where.code);
          if (existing) {
            const merged = { ...existing, ...update };
            const inc = update.failures as { increment?: number } | undefined;
            if (inc?.increment) {
              merged.failures = existing.failures + inc.increment;
            }
            rows.set(where.code, merged);
          } else {
            rows.set(where.code, {
              ...create,
              firstFailedAt: new Date(),
              lockedUntil: create.lockedUntil ?? null,
            });
          }
          return Promise.resolve(rows.get(where.code));
        }
      ),
    },
  };
}

describe("createCodeLockout", () => {
  it("is not locked before any failures", async () => {
    const lockout = createCodeLockout(fakePrisma() as never);
    expect(await lockout.isLocked("ABC123")).toBe(false);
  });

  it("does not lock below the threshold", async () => {
    const lockout = createCodeLockout(fakePrisma() as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      await lockout.trackFailure("ABC123");
    }
    expect(await lockout.isLocked("ABC123")).toBe(false);
  });

  it("locks the code after LOCKOUT_THRESHOLD failures", async () => {
    const lockout = createCodeLockout(fakePrisma() as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await lockout.trackFailure("ABC123");
    }
    expect(await lockout.isLocked("ABC123")).toBe(true);
  });

  it("does not leak failures across codes", async () => {
    const lockout = createCodeLockout(fakePrisma() as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await lockout.trackFailure("ABC123");
    }
    expect(await lockout.isLocked("DEF456")).toBe(false);
  });

  it("clear resets the lockout", async () => {
    const lockout = createCodeLockout(fakePrisma() as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await lockout.trackFailure("ABC123");
    }
    await lockout.clear("ABC123");
    expect(await lockout.isLocked("ABC123")).toBe(false);
  });

  it("keeps an active lock even after the failure window passes", async () => {
    vi.useFakeTimers();
    const lockout = createCodeLockout(fakePrisma() as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await lockout.trackFailure("ABC123");
    }
    vi.advanceTimersByTime(FAILURE_WINDOW_MS + 1);
    // A stray failure inside the lock period must not reset the counter.
    await lockout.trackFailure("ABC123");
    expect(await lockout.isLocked("ABC123")).toBe(true);
  });

  it("ages out below-threshold failures after the window", async () => {
    vi.useFakeTimers();
    const prisma = fakePrisma();
    const lockout = createCodeLockout(prisma as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      await lockout.trackFailure("ABC123");
    }
    vi.advanceTimersByTime(FAILURE_WINDOW_MS + 1);
    await lockout.trackFailure("ABC123");
    // Count restarted at 1 — still far from the threshold.
    for (let i = 0; i < LOCKOUT_THRESHOLD - 2; i++) {
      await lockout.trackFailure("ABC123");
    }
    expect(await lockout.isLocked("ABC123")).toBe(false);
    await lockout.trackFailure("ABC123");
    expect(await lockout.isLocked("ABC123")).toBe(true);
  });

  it("trackFailure resolves when a concurrent clear deletes the row", async () => {
    const prisma = fakePrisma();
    const lockout = createCodeLockout(prisma as never);
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      await lockout.trackFailure("ABC123");
    }
    // Simulate a successful lookup deleting the row before the lock write.
    prisma.codeLockout.updateMany.mockImplementationOnce(() => {
      prisma.codeLockout.deleteMany({ where: { code: "ABC123" } });
      return Promise.resolve({ count: 0 });
    });
    await lockout.trackFailure("ABC123");
    expect(await lockout.isLocked("ABC123")).toBe(false);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
