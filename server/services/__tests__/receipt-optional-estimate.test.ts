import { describe, expect, it } from "vitest";
import { toNum } from "../receipt.service.js";

describe("receipt toNum", () => {
  it("treats a missing estimate (por orçamentar) as 0 instead of crashing", () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum({ toNumber: () => 12.5 })).toBe(12.5);
  });
});
