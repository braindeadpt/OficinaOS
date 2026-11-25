import { describe, expect, it } from "vitest";
import {
  isPontoOnlyAllowedPath,
  navItemVisibleInPontoOnly,
} from "@/lib/ponto-only";

describe("modo só ponto — superfície de navegação", () => {
  it("mantém apenas o ponto e as definições no menu", () => {
    expect(navItemVisibleInPontoOnly({ to: "/ponto" }, true)).toBe(true);
    expect(navItemVisibleInPontoOnly({ to: "/settings" }, true)).toBe(true);
    expect(navItemVisibleInPontoOnly({ to: "/jobs" }, true)).toBe(false);
    expect(navItemVisibleInPontoOnly({ to: "/parts" }, true)).toBe(false);
    expect(navItemVisibleInPontoOnly({ to: "/pos" }, true)).toBe(false);
  });

  it("modo normal não altera o menu", () => {
    expect(navItemVisibleInPontoOnly({ to: "/jobs" }, false)).toBe(true);
  });

  it("rotas de reparações, stock, caixa e POS ficam fora", () => {
    for (const path of ["/jobs", "/repairs", "/parts", "/pos", "/reports"]) {
      expect(isPontoOnlyAllowedPath(path)).toBe(false);
    }
    for (const path of [
      "/",
      "/ponto",
      "/ponto/abc",
      "/settings",
      "/profile/1",
    ]) {
      expect(isPontoOnlyAllowedPath(path)).toBe(true);
    }
  });
});
