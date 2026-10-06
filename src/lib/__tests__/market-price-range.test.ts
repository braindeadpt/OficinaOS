import { describe, expect, it } from "vitest";
import { formatPriceRange } from "../market-price-range";

const fmt = (v: number) => `${v.toFixed(2)} €`;

describe("formatPriceRange", () => {
  it("formats min–max when the cloud provides both", () => {
    expect(
      formatPriceRange({ minCents: 4000, maxCents: 9000 }, fmt, "n/a")
    ).toBe("40.00 € – 90.00 €");
  });

  it("shows the insufficient-data label when min/max are null (<5 shops)", () => {
    expect(
      formatPriceRange(
        { minCents: null, maxCents: null },
        fmt,
        "Dados insuficientes"
      )
    ).toBe("Dados insuficientes");
    expect(formatPriceRange({ minCents: 100, maxCents: null }, fmt, "x")).toBe(
      "x"
    );
  });
});
