import { describe, expect, it } from "vitest";
import { createCodeLockout, LOCKOUT_THRESHOLD } from "../utils/code-lockout.js";

describe("createCodeLockout", () => {
  it("is not locked before any failures", () => {
    const lockout = createCodeLockout();
    expect(lockout.isLocked("ABC123")).toBe(false);
  });

  it("does not lock below the threshold", () => {
    const lockout = createCodeLockout();
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      lockout.trackFailure("ABC123");
    }
    expect(lockout.isLocked("ABC123")).toBe(false);
  });

  it("locks the code after LOCKOUT_THRESHOLD failures", () => {
    const lockout = createCodeLockout();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      lockout.trackFailure("ABC123");
    }
    expect(lockout.isLocked("ABC123")).toBe(true);
  });

  it("does not leak failures across codes", () => {
    const lockout = createCodeLockout();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      lockout.trackFailure("ABC123");
    }
    expect(lockout.isLocked("DEF456")).toBe(false);
  });

  it("clear resets the lockout", () => {
    const lockout = createCodeLockout();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      lockout.trackFailure("ABC123");
    }
    lockout.clear("ABC123");
    expect(lockout.isLocked("ABC123")).toBe(false);
  });
});
