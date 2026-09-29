import { describe, expect, it, vi } from "vitest";
import { generateSaleCode } from "../sale-code.js";

/**
 * Mirrors the bounded INSERT .. ON CONFLICT: the row comes back only while the
 * counter is under the ceiling, so an exhausted year returns nothing.
 */
function makePrisma(lastSeq: number | string | null) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(lastSeq === null ? [] : [{ lastSeq }]),
  } as unknown as Parameters<typeof generateSaleCode>[0];
}

describe("generateSaleCode", () => {
  it("formats the allocated sequence with year padding", async () => {
    expect(await generateSaleCode(makePrisma(42))).toBe("SALE-2026-000042");
  });

  it("coerces a driver-returned string sequence", async () => {
    expect(await generateSaleCode(makePrisma("7"))).toBe("SALE-2026-000007");
  });

  it("refuses an exhausted year without allocating a code", async () => {
    // The counter at the ceiling returns no row: nothing is committed, so the
    // counter is never pushed out of range and future years are unaffected.
    await expect(generateSaleCode(makePrisma(null))).rejects.toThrow(
      "errors.job_code_overflow"
    );
  });
});
