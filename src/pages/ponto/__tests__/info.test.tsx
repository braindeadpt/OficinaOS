// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import PontoInfoPage from "../info";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { exists: (key: string) => key.endsWith("_company") },
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/shop-mode", () => ({
  useShopModeStore: (selector: (s: { shopMode: null }) => unknown) =>
    selector({ shopMode: null }),
}));

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === "/ponto/status") {
        return Promise.resolve({ data: { enabled: true } });
      }
      if (url === "/settings/shop") {
        return Promise.resolve({
          data: {
            pontoInfoText: null,
            shopMode: "ponto_only",
            shopName: "",
          },
        });
      }
      return Promise.reject(new Error(url));
    }),
  },
}));

describe("PontoInfoPage em entrada direta", () => {
  it("usa a terminologia de empresa mesmo com a store de modo ainda vazia", async () => {
    render(
      <MemoryRouter>
        <PontoInfoPage />
      </MemoryRouter>
    );

    expect(
      await screen.findByText("ponto.info_doc_how_1_company")
    ).toBeInTheDocument();
    expect(screen.queryByText("ponto.info_doc_how_1")).not.toBeInTheDocument();
  });
});
