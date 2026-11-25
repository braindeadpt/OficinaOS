// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api", () => ({
  default: { get: mocks.get, post: mocks.post, put: mocks.put },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import SettingsPontoSection from "../settings-ponto-section";

const SHOP = {
  pontoExitReminderTime: null,
  pontoExternalAutoApprove: true,
  pontoExternalPhotoRequired: false,
  pontoGeoLat: 38.7223,
  pontoGeoLng: -9.1393,
  pontoInfoText: null,
  pontoPauseReminderMinutes: 20,
  pontoRadiusM: 100,
  pontoSmsNumber: null,
  pontoWaNumber: null,
};

function mockApi() {
  mocks.get.mockImplementation((url: string) => {
    if (url === "/ponto/status") {
      return Promise.resolve({ data: { enabled: true } });
    }
    if (url === "/settings/shop") {
      return Promise.resolve({ data: { ...SHOP } });
    }
    if (url === "/ponto/config") {
      return Promise.resolve({
        data: { configured: true, qrId: "qr-1", slug: "my-shop" },
      });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  mocks.put.mockResolvedValue({ data: {} });
  mocks.post.mockResolvedValue({ data: { ok: true, qrId: "qr-2" } });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSection(
  props: { hasUnsavedChanges?: boolean; refreshNonce?: number } = {}
) {
  return render(
    <MemoryRouter>
      <LocationProbe />
      <SettingsPontoSection onToast={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

function shopPutBody() {
  const call = mocks.put.mock.calls.find(([url]) => url === "/settings/shop");
  return call?.[1] as Record<string, unknown> | undefined;
}

const statusCalls = () =>
  mocks.get.mock.calls.filter(([url]) => url === "/ponto/status").length;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

describe("SettingsPontoSection — validação antes de gravar", () => {
  it("envia coordenadas com vírgula decimal como números", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.latitude"), {
      target: { value: "38,7223" },
    });
    fireEvent.change(screen.getByLabelText("ponto.longitude"), {
      target: { value: "-9,1393" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(shopPutBody()).toBeDefined());
    expect(shopPutBody()?.pontoGeoLat).toBeCloseTo(38.7223);
    expect(shopPutBody()?.pontoGeoLng).toBeCloseTo(-9.1393);
  });

  it("rejeita coordenada inválida sem a converter em null", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.latitude"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(
      await screen.findByText("validations.invalid_number")
    ).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("envia null nas coordenadas só quando ambas ficam vazias", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.latitude"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("ponto.longitude"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(shopPutBody()).toBeDefined());
    expect(shopPutBody()?.pontoGeoLat).toBeNull();
    expect(shopPutBody()?.pontoGeoLng).toBeNull();
  });

  it("rejeita o par incompleto (uma coordenada vazia)", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.latitude"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(
      await screen.findAllByText("validations.incomplete_point")
    ).not.toHaveLength(0);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("normaliza o número de WhatsApp com espaços antes de gravar", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.wa_number"), {
      target: { value: "+351 912 345 678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(shopPutBody()).toBeDefined());
    expect(shopPutBody()?.pontoWaNumber).toBe("+351912345678");
  });

  it("rejeita telefone inválido sem gravar", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.wa_number"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(await screen.findByText("ponto.invalid_phone")).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejeita raio não inteiro em vez de o truncar", async () => {
    renderSection();
    fireEvent.change(await screen.findByLabelText("ponto.radius"), {
      target: { value: "25,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(
      await screen.findByText("validations.invalid_integer")
    ).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

describe("SettingsPontoSection — saída para a folha QR", () => {
  it("pede confirmação antes de sair com alterações por guardar", async () => {
    renderSection({ hasUnsavedChanges: true });
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(screen.getByRole("link", { name: "ponto.qr_open" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/");

    fireEvent.click(
      screen.getByRole("button", { name: "add_part_modal.discard" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/ponto/qr")
    );
  });

  it("mantém a edição quando se escolhe continuar", async () => {
    renderSection({ hasUnsavedChanges: true });
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(screen.getByRole("link", { name: "ponto.qr_open" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "add_part_modal.keep_editing",
      })
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("abre o QR diretamente quando não há alterações", async () => {
    renderSection();
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(screen.getByRole("link", { name: "ponto.qr_open" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/ponto/qr")
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("SettingsPontoSection — saída para o aviso ao trabalhador", () => {
  it("pede confirmação e descartar abre o aviso, não o QR", async () => {
    renderSection({ hasUnsavedChanges: true });
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(screen.getByRole("link", { name: "ponto.info_open" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/");

    fireEvent.click(
      screen.getByRole("button", { name: "add_part_modal.discard" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/ponto/info")
    );
  });

  it("mantém o rascunho quando se escolhe continuar", async () => {
    renderSection({ hasUnsavedChanges: true });
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(screen.getByRole("link", { name: "ponto.info_open" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "add_part_modal.keep_editing",
      })
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });
});

describe("SettingsPontoSection — refreshNonce (Sincronize agora)", () => {
  it("recarrega a secção quando o nonce muda", async () => {
    const { rerender } = renderSection({ refreshNonce: 0 });
    await screen.findByLabelText("ponto.latitude");
    expect(statusCalls()).toBe(1);

    rerender(
      <MemoryRouter>
        <LocationProbe />
        <SettingsPontoSection onToast={vi.fn()} refreshNonce={1} />
      </MemoryRouter>
    );

    await waitFor(() => expect(statusCalls()).toBe(2));
  });

  it("não recarrega por cima de um rascunho por guardar", async () => {
    const { rerender } = renderSection({ refreshNonce: 0 });
    fireEvent.change(await screen.findByLabelText("ponto.latitude"), {
      target: { value: "41,1579" },
    });
    expect(statusCalls()).toBe(1);

    rerender(
      <MemoryRouter>
        <LocationProbe />
        <SettingsPontoSection onToast={vi.fn()} refreshNonce={1} />
      </MemoryRouter>
    );
    // Dá tempo ao efeito correr — o refresh não pode acontecer.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusCalls()).toBe(1);
  });
});

describe("SettingsPontoSection — regenerar QR", () => {
  it("pede confirmação antes de regenerar e cancelar não chama a API", async () => {
    renderSection();
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate" })
    );
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("confirmar chama POST /ponto/regenerate-qr e refaz o refresh", async () => {
    const onToast = vi.fn();
    render(
      <MemoryRouter>
        <SettingsPontoSection onToast={onToast} />
      </MemoryRouter>
    );
    await screen.findByLabelText("ponto.latitude");
    const configCallsBefore = mocks.get.mock.calls.filter(
      ([url]) => url === "/ponto/config"
    ).length;

    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate" })
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "ponto.qr_regenerate_confirm",
      })
    );

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/ponto/regenerate-qr")
    );
    await waitFor(() => {
      const configCalls = mocks.get.mock.calls.filter(
        ([url]) => url === "/ponto/config"
      ).length;
      expect(configCalls).toBeGreaterThan(configCallsBefore);
    });
    expect(onToast).toHaveBeenCalledWith("ponto.qr_regenerated", "success");
  });

  it("falha da API mostra toast de erro e não quebra a secção", async () => {
    mocks.post.mockRejectedValueOnce(new Error("boom"));
    const onToast = vi.fn();
    render(
      <MemoryRouter>
        <SettingsPontoSection onToast={onToast} />
      </MemoryRouter>
    );
    await screen.findByLabelText("ponto.latitude");

    fireEvent.click(
      screen.getByRole("button", { name: "ponto.qr_regenerate" })
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "ponto.qr_regenerate_confirm",
      })
    );

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        "ponto.qr_regenerate_failed",
        "error"
      )
    );
  });
});
