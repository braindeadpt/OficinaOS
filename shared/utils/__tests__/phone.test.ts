import { describe, expect, it } from "vitest";
import { normalizePhone } from "../phone";

describe("normalizePhone", () => {
  it("drops spaces, dashes, dots and parentheses", () => {
    expect(normalizePhone("912 345 678")).toBe("912345678");
    expect(normalizePhone("912-345-678")).toBe("912345678");
    expect(normalizePhone("(21) 345.6789")).toBe("213456789");
  });

  it("keeps a leading + and maps a 00 prefix to +", () => {
    expect(normalizePhone(" +351 912 345 678 ")).toBe("+351912345678");
    expect(normalizePhone("00351 912 345 678")).toBe("+351912345678");
  });

  it("does not guess a country code", () => {
    expect(normalizePhone("912345678")).not.toBe(
      normalizePhone("+351912345678")
    );
  });
});
