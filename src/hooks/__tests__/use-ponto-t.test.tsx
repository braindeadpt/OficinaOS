// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shopMode: { value: "repair_shop" as "ponto_only" | "repair_shop" },
  t: vi.fn((key: string) => key),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { exists: (key: string) => key.endsWith("_company") },
    t: mocks.t,
  }),
}));

vi.mock("@/stores/shop-mode", () => ({
  useShopModeStore: (selector: (s: { shopMode: string }) => unknown) =>
    selector({ shopMode: mocks.shopMode.value }),
}));

import { usePontoT } from "../use-ponto-t";

describe("usePontoT", () => {
  beforeEach(() => {
    mocks.shopMode.value = "repair_shop";
    mocks.t.mockClear();
  });

  it("usa a chave normal numa oficina", () => {
    const { result } = renderHook(() => usePontoT());
    expect(result.current("ponto.location_title")).toBe("ponto.location_title");
  });

  it("usa a variante neutra de empresa no modo só ponto", () => {
    mocks.shopMode.value = "ponto_only";
    const { result } = renderHook(() => usePontoT());
    expect(result.current("ponto.location_title")).toBe(
      "ponto.location_title_company"
    );
  });
});
