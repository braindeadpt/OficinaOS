import { describe, expect, it } from "vitest";
import { formatCurrency, setFormatLocale } from "@/lib/format";

// Intl separates the symbol with a non-breaking space (U+00A0) and French uses
// a narrow no-break space (U+202F) as the thousands separator.
const NBSP = "\u00a0";
const NNBSP = "\u202f";

describe("formatCurrency", () => {
  it("formats with the active UI language instead of a fixed market", () => {
    setFormatLocale("pt-PT");
    expect(formatCurrency(1234.5, "EUR")).toBe(`1234,5${NBSP}€`);

    setFormatLocale("en-GB");
    expect(formatCurrency(1234.5, "EUR")).toBe("€1,234.5");

    setFormatLocale("fr-FR");
    expect(formatCurrency(1234.5, "EUR")).toBe(`1${NNBSP}234,5${NBSP}€`);
  });

  it("accepts an explicit locale as an override", () => {
    setFormatLocale("en-GB");
    expect(formatCurrency(1234.5, "EUR", "pt-PT")).toBe(`1234,5${NBSP}€`);
  });

  it("renders the requested currency", () => {
    setFormatLocale("en-GB");
    expect(formatCurrency(10, "USD")).not.toBe(formatCurrency(10, "GBP"));
  });

  it("falls back to the base language when no locale was set", () => {
    setFormatLocale("");
    expect(formatCurrency(1234.5, "EUR")).toBe(`1234,5${NBSP}€`);
  });
});
