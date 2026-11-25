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
  cloud: { down: false, qrId: "qr-one" as string | undefined },
}));
vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn((url: string) => {
      if (cloud.down && url === "/ponto/config") {
        // O proxy da app degrada para configured:false sem rejeitar —
        // é isto que acontece em produção com a Cloud em baixo.
        return Promise.resolve({ data: { configured: false } });
      }
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
    cloud.down = false;
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

  it("rotação com resposta perdida mostra o QR novo sem erro", async () => {
    // A Cloud rodou o qrId mas a resposta perdeu-se: a releitura traz o
    // novo — dizer «o impresso continua válido» seria mentira.
    apiPost.mockImplementation(() => {
      cloud.qrId = "qr-two";
      return Promise.reject(new Error("resposta perdida"));
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
      screen.queryByText("ponto.qr_regenerate_error")
    ).not.toBeInTheDocument();
  });

  it("Cloud em baixo na regeneração mostra o aviso neutro mesmo sem folha", async () => {
    apiPost.mockImplementation(() => {
      cloud.down = true;
      return Promise.reject(new Error("cloud em baixo"));
    });
    await renderReady();
    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate_confirm" })
    );
    await screen.findByText("ponto.qr_regenerate_unknown");
    // Sem afirmar que o impresso continua válido — não se sabe.
    expect(
      screen.queryByText("ponto.qr_regenerate_error")
    ).not.toBeInTheDocument();
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
