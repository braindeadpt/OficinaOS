import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone, phoneSearchDigits } from "../phone";

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

describe("isValidPhone", () => {
  it("accepts national and international formats", () => {
    expect(isValidPhone("912345678")).toBe(true);
    expect(isValidPhone("+351 912 345 678")).toBe(true);
    expect(isValidPhone("00351 912 345 678")).toBe(true);
    expect(isValidPhone("(21) 3456-7890")).toBe(true);
    expect(isValidPhone("+44 7911 123456")).toBe(true);
  });

  it("rejects free text, short numbers and letters", () => {
    expect(isValidPhone("abc")).toBe(false);
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("91234abc678")).toBe(false);
    expect(isValidPhone("+351 912 345 678 999 000")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("phoneSearchDigits", () => {
  it("ignores spaces and a Portuguese prefix", () => {
    expect(phoneSearchDigits("+351 912 345 678")).toBe("912345678");
    expect(phoneSearchDigits("00351 912 345 678")).toBe("912345678");
    expect(phoneSearchDigits("351912345678")).toBe("912345678");
    expect(phoneSearchDigits("912 345 678")).toBe("912345678");
    expect(phoneSearchDigits("+351 912")).toBe("912");
  });

  it("keeps other country codes and short local digits", () => {
    expect(phoneSearchDigits("+44 7911 123456")).toBe("447911123456");
    expect(phoneSearchDigits("351")).toBe("351");
    expect(phoneSearchDigits("abc")).toBe("");
  });
});
