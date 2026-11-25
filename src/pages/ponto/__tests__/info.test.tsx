// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import ptMessages from "../../../i18n/locales/pt.json";
import PontoInfoPage from "../info";

const COMPANY_INTRO = /A empresa utiliza um sistema eletrónico/;
const COMPANY_QR = /código QR afixado na empresa/;
const SHOP_WORDING = /na loja/;

function translate(key: string, options?: Record<string, unknown>): string {
  const raw = ptMessages[key as keyof typeof ptMessages] ?? key;
  let text = String(raw);
  if (typeof options?.controller === "string") {
    text = text.replaceAll("{{controller}}", options.controller);
  }
  return text;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { exists: (key: string) => key in ptMessages },
    t: translate,
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

    expect(await screen.findByText(COMPANY_INTRO)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_QR)).toBeInTheDocument();
    expect(screen.queryByText(SHOP_WORDING)).not.toBeInTheDocument();
  });
});
