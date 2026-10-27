import { describe, expect, it } from "vitest";
import { parseRevenueGoalInput } from "../parse-revenue-goal";

describe("parseRevenueGoalInput", () => {
  it("returns null only for a deliberately empty field", () => {
    expect(parseRevenueGoalInput("")).toBeNull();
    expect(parseRevenueGoalInput("   ")).toBeNull();
  });

  it("accepts integers and local decimal formats", () => {
    expect(parseRevenueGoalInput("4500")).toBe(4500);
    expect(parseRevenueGoalInput("4500,50")).toBe(4500.5);
    expect(parseRevenueGoalInput("4 500,50")).toBe(4500.5);
    expect(parseRevenueGoalInput("2.500,50")).toBe(2500.5);
    expect(parseRevenueGoalInput("4500.50")).toBe(4500.5);
    expect(parseRevenueGoalInput("2.500")).toBe(2500);
    expect(parseRevenueGoalInput("12.500")).toBe(12_500);
    expect(parseRevenueGoalInput("1.250.000")).toBe(1_250_000);
    expect(parseRevenueGoalInput("2.5")).toBe(2.5);
  });

  it("rejects free text, negatives and out-of-range values", () => {
    expect(parseRevenueGoalInput("abc")).toBeUndefined();
    expect(parseRevenueGoalInput("45oo")).toBeUndefined();
    expect(parseRevenueGoalInput("-1")).toBeUndefined();
    expect(parseRevenueGoalInput("1,2,3")).toBeUndefined();
    expect(parseRevenueGoalInput("100000000")).toBeUndefined();
  });
});
