import { describe, expect, it } from "vitest";
import { isValidImei, normalizeImei } from "../imei";

// Luhn-valid IMEIs (classic GSM example + computed check digits).
const VALID_IMEIS = ["490154203237518", "354599070401594", "351756051523993"];

const INVALID_IMEIS = [
  "490154203237519", // wrong check digit
  "123456789012345",
  "49015420323751", // 14 digits
  "4901542032375180", // 17 digits
  "ABCDEFGHIJKLMNO", // non-numeric
];

describe("normalizeImei", () => {
  it("strips spaces, dashes and IMEI: prefixes", () => {
    expect(normalizeImei(" 4901 5420-3237-518 ")).toBe("490154203237518");
    expect(normalizeImei("IMEI: 490154203237518")).toBe("490154203237518");
    expect(normalizeImei("imei:490154203237518")).toBe("490154203237518");
  });
});

describe("isValidImei", () => {
  it("accepts Luhn-valid IMEIs", () => {
    for (const imei of VALID_IMEIS) {
      expect(isValidImei(imei)).toBe(true);
    }
  });

  it("rejects invalid checksums, lengths and garbage", () => {
    for (const imei of INVALID_IMEIS) {
      expect(isValidImei(imei)).toBe(false);
    }
  });

  it("accepts spaced/dashed input after normalization", () => {
    expect(isValidImei("4901 5420 3237 518")).toBe(true);
  });
});
