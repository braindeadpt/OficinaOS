import { DEVICE_CATEGORIES } from "@shared/constants/device-categories.js";
import catalog from "@shared/device-catalog.json";
import { describe, expect, it } from "vitest";

interface CatalogEntry {
  category: string;
  model: string;
}

const BRANDS = (
  catalog as { brands: { models: CatalogEntry[]; name: string }[] }
).brands;
const MODELS = BRANDS.flatMap((b) =>
  b.models.map((m) => ({ brand: b.name, ...m }))
);
const WATCH_NAME_RE = /watch\d|watch (ultra|classic|gt|pro|s\d|x\d|band|fit)/i;

describe("device catalog data", () => {
  it("uses only known device categories", () => {
    const allowed = new Set<string>(DEVICE_CATEGORIES);
    const bad = MODELS.filter((m) => !allowed.has(m.category));
    expect(bad).toEqual([]);
  });

  it("classifies watch-named models as watch", () => {
    const bad = MODELS.filter(
      (m) => WATCH_NAME_RE.test(m.model) && m.category !== "watch"
    );
    expect(bad).toEqual([]);
  });

  it("classifies known tablets as tablet, not phone", () => {
    const pixelC = MODELS.find((m) => m.model === "Pixel C");
    expect(pixelC?.category).toBe("tablet");
    const galaxyWatch8 = MODELS.find((m) => m.model === "Galaxy Watch8");
    expect(galaxyWatch8?.category).toBe("watch");
  });

  it("has no duplicate brand+model pairs", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of MODELS) {
      const key = `${m.brand}\u0000${m.model}`;
      if (seen.has(key)) {
        dupes.push(key);
      }
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });
});
