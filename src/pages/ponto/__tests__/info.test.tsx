// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import ptMessages from "../../../i18n/locales/pt.json";
import PontoInfoPage from "../info";

const COMPANY_INTRO = /A empresa utiliza um sistema eletrónico/;
const COMPANY_QR = /código QR afixado na empresa/;
const COMPANY_NIF = /NIF: 501234567/;
const COMPANY_ADDRESS = /Rua A, 1, Porto/;
const REPAIR_WORDING = /\bloja\b|\boficina\b/i;

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
            address: "Rua A, 1",
            phone: "+351210000000",
            pontoInfoText: null,
            shopLocality: "Porto",
            shopMode: "ponto_only",
            shopName: "",
            shopTaxId: "501234567",
          },
        });
      }
      if (url === "/ponto/info-deliveries") {
        return Promise.resolve({
          data: {
            missingActiveCount: 1,
            rows: [
              {
                delivery: null,
                isActive: true,
                name: "Ana Silva",
                pontoEnabled: true,
                userId: "u1",
                username: "ana",
              },
              {
                delivery: null,
                isActive: true,
                name: "Bruno Costa",
                pontoEnabled: true,
                userId: "u2",
                username: "bruno",
              },
              {
                delivery: null,
                isActive: false,
                name: "Carla Inativa",
                pontoEnabled: true,
                userId: "u3",
                username: "carla",
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(url));
    }),
  },
}));

window.print = vi.fn();

describe("PontoInfoPage em entrada direta", () => {
  it("usa a terminologia de empresa mesmo com a store de modo ainda vazia", async () => {
    const { container } = render(
      <MemoryRouter>
        <PontoInfoPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(COMPANY_INTRO)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_QR)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(REPAIR_WORDING);
  });

  it("preenche automaticamente a empresa e o nome do trabalhador na folha individual", async () => {
    render(
      <MemoryRouter initialEntries={["/ponto/info?userId=u1"]}>
        <PontoInfoPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(COMPANY_NIF)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(
      screen.getByText("Modelo — em revisão jurídica.")
    ).toBeInTheDocument();
  });

  it("imprime uma folha por trabalhador ativo do ponto em modo em lote", async () => {
    render(
      <MemoryRouter initialEntries={["/ponto/info?all=1"]}>
        <PontoInfoPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Ana Silva")).toBeInTheDocument();
    expect(screen.getByText("Bruno Costa")).toBeInTheDocument();
    expect(screen.queryByText("Carla Inativa")).not.toBeInTheDocument();
    expect(screen.getAllByText("Modelo — em revisão jurídica.")).toHaveLength(
      2
    );
  });
});
