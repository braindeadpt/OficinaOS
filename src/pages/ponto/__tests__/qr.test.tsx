// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mocks = vi.hoisted(() => ({ get: vi.fn(), toDataURL: vi.fn() }));
vi.mock("@/lib/api", () => ({
  default: { get: mocks.get },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: mocks.toDataURL },
}));

import PontoQrPage from "../qr";

function mockApi(config: Record<string, unknown>) {
  mocks.get.mockImplementation((url: string) => {
    if (url === "/ponto/status") {
      return Promise.resolve({ data: { enabled: true } });
    }
    if (url === "/settings/shop") {
      return Promise.resolve({
        data: {
          cloudApiUrl: "https://cloud.test/",
          pontoSmsNumber: null,
          pontoWaNumber: null,
          shopName: "Loja X",
        },
      });
    }
    if (url === "/ponto/config") {
      return Promise.resolve({ data: config });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  mocks.toDataURL.mockImplementation((url: string) =>
    Promise.resolve(`data:image/png;qr-of:${url}`)
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PontoQrPage />
    </MemoryRouter>
  );
}

async function qrUrl(): Promise<string> {
  await waitFor(() => expect(mocks.toDataURL).toHaveBeenCalled());
  return mocks.toDataURL.mock.calls[0][0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PontoQrPage — qrId vs slug", () => {
  it("usa o qrId aleatório quando a Cloud o devolve", async () => {
    mockApi({
      configured: true,
      qrId: "ab12cd34ef56ab12cd34ef56ab12cd34",
      slug: "loja-x",
    });
    renderPage();
    expect(await qrUrl()).toBe(
      "https://cloud.test/ponto/ab12cd34ef56ab12cd34ef56ab12cd34"
    );
  });

  it("cai para o slug legado quando não há qrId", async () => {
    mockApi({ configured: true, slug: "loja-x" });
    renderPage();
    expect(await qrUrl()).toBe("https://cloud.test/ponto/loja-x");
  });

  it("indisponível quando não há qrId nem slug", async () => {
    mockApi({ configured: true });
    renderPage();
    expect(await screen.findByText("ponto.qr_unavailable")).toBeInTheDocument();
    expect(mocks.toDataURL).not.toHaveBeenCalled();
  });

  it("indisponível quando a Cloud ainda não tem configuração", async () => {
    mockApi({ configured: false });
    renderPage();
    expect(await screen.findByText("ponto.qr_unavailable")).toBeInTheDocument();
    expect(mocks.toDataURL).not.toHaveBeenCalled();
  });
});
