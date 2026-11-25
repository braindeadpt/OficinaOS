// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PontoQrPage from "../qr";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async (url: string) => `data:${url}`) },
}));

// Estado mutável partilhado pelos mocks: o qrId que a "Cloud" devolve.
const { apiPost, cloud } = vi.hoisted(() => ({
  apiPost: vi.fn(() => Promise.resolve({})),
  cloud: { qrId: "qr-one" as string | undefined },
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
            cloudApiUrl: "https://cloud.test",
            shopName: "Oficina X",
          },
        });
      }
      return Promise.resolve({
        data: {
          qrId: cloud.qrId,
          slug: "oficina-x",
          smsNumber: null,
          waNumber: null,
        },
      });
    }),
    post: apiPost,
  },
}));

async function renderReady() {
  render(
    <MemoryRouter>
      <PontoQrPage />
    </MemoryRouter>
  );
  // O URL do QR aparece em texto na folha quando está pronta.
  await screen.findByText("https://cloud.test/ponto/qr-one");
}

describe("PontoQrPage — qrId e regeneração (WP0.2)", () => {
  beforeEach(() => {
    cloud.qrId = "qr-one";
    apiPost.mockClear();
    apiPost.mockImplementation(() => Promise.resolve({}));
  });

  it("renderiza o QR com o qrId da Cloud, não o slug", async () => {
    await renderReady();
    expect(
      screen.getByText("https://cloud.test/ponto/qr-one")
    ).toBeInTheDocument();
  });

  it("regenerar substitui o QR na folha pelo novo qrId", async () => {
    apiPost.mockImplementation(() => {
      cloud.qrId = "qr-two";
      return Promise.resolve({});
    });
    await renderReady();
    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate_confirm" })
    );
    await waitFor(() => {
      expect(
        screen.getByText("https://cloud.test/ponto/qr-two")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("https://cloud.test/ponto/qr-one")
    ).not.toBeInTheDocument();
  });

  it("falha na regeneração mostra o erro e mantém o QR antigo", async () => {
    apiPost.mockRejectedValueOnce(new Error("cloud antiga"));
    await renderReady();
    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate_confirm" })
    );
    await screen.findByText("ponto.qr_regenerate_error");
    expect(
      screen.getByText("https://cloud.test/ponto/qr-one")
    ).toBeInTheDocument();
  });

  it("cai para o slug quando a Cloud ainda não devolve qrId", async () => {
    cloud.qrId = undefined;
    render(
      <MemoryRouter>
        <PontoQrPage />
      </MemoryRouter>
    );
    await screen.findByText("https://cloud.test/ponto/oficina-x");
  });
});
