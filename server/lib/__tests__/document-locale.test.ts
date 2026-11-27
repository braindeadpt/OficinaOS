import { describe, expect, it } from "vitest";
import {
  documentLocaleForCountry,
  normalizeDocumentLocale,
} from "../document-locale.js";

describe("documentLocaleForCountry", () => {
  it("maps Iberian/francophone countries to their document language", () => {
    expect(documentLocaleForCountry("PT")).toBe("pt");
    expect(documentLocaleForCountry("BR")).toBe("pt");
    expect(documentLocaleForCountry("ES")).toBe("es");
    expect(documentLocaleForCountry("FR")).toBe("fr");
  });

  it("falls back to English for unmapped countries", () => {
    expect(documentLocaleForCountry("DE")).toBe("en");
    expect(documentLocaleForCountry("US")).toBe("en");
  });

  it("missing/invalid country keeps Portuguese shop behavior unchanged", () => {
    expect(documentLocaleForCountry(null)).toBe("pt");
    expect(documentLocaleForCountry(undefined)).toBe("pt");
    expect(documentLocaleForCountry("pt")).toBe("pt");
  });
});

describe("normalizeDocumentLocale", () => {
  it("accepts regional locales and unknown ones fall back to pt", () => {
    expect(normalizeDocumentLocale("pt-PT")).toBe("pt");
    expect(normalizeDocumentLocale("en-US")).toBe("en");
    expect(normalizeDocumentLocale("de")).toBe("pt");
    expect(normalizeDocumentLocale(undefined)).toBe("pt");
  });
});
