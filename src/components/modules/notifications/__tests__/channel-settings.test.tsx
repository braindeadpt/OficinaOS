// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  fetchSmsCloudDevice: vi.fn(),
  fetchWaTemplates: vi.fn(),
  revokeWhatsAppCloudCredentials: vi.fn(),
  saveShopSettings: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/settings", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      fetchSmsCloudDevice: storeMocks.fetchSmsCloudDevice,
      fetchWaTemplates: storeMocks.fetchWaTemplates,
      revokeWhatsAppCloudCredentials: storeMocks.revokeWhatsAppCloudCredentials,
      saveShopSettings: storeMocks.saveShopSettings,
      shopSettings: null,
      smsCloudDevice: null,
      smsSettings: null,
      waTemplates: [],
      whatsAppSettings: null,
    }),
}));

import ChannelSettings from "../channel-settings";

type ChannelSettingsProps = ComponentProps<typeof ChannelSettings>;
type WhatsAppSettings = NonNullable<ChannelSettingsProps["whatsAppSettings"]>;
type SaveWhatsAppSettings = ChannelSettingsProps["onSaveWhatsAppSettings"];

function whatsAppSettings(
  patch: Partial<WhatsAppSettings> = {}
): WhatsAppSettings {
  return {
    enabled: false,
    phoneNumberId: "1234",
    credentialsAtCloud: false,
    hasApiToken: false,
    transport: "meta",
    whatsappModule: true,
    ...patch,
  } as WhatsAppSettings;
}

function renderChannelSettings(
  settings: WhatsAppSettings,
  onSaveWhatsAppSettings: SaveWhatsAppSettings = vi.fn<SaveWhatsAppSettings>(
    () => Promise.resolve()
  )
) {
  return {
    onSaveWhatsAppSettings,
    ...render(
      <ChannelSettings
        onFetchWhatsAppSettings={vi.fn(() => Promise.resolve())}
        onSaveSmsSettings={vi.fn(() => Promise.resolve())}
        onSaveWhatsAppSettings={onSaveWhatsAppSettings}
        onSendSmsTest={vi.fn(() => Promise.resolve({ ok: true }))}
        smsSettings={null}
        whatsAppSettings={settings}
      />
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.fetchSmsCloudDevice.mockResolvedValue(undefined);
  storeMocks.fetchWaTemplates.mockResolvedValue(undefined);
});

describe("ChannelSettings — estado pós-revogação", () => {
  it("mostra o aviso explícito mesmo quando o canal está desligado", async () => {
    renderChannelSettings(whatsAppSettings());

    expect(
      await screen.findByText("whatsapp_official_disconnected")
    ).toBeInTheDocument();
  });

  it("não mostra o aviso enquanto existe um token local utilizável", async () => {
    renderChannelSettings(whatsAppSettings({ hasApiToken: true }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByText("whatsapp_official_disconnected")
    ).not.toBeInTheDocument();
  });

  it("um ID em branco não bloqueia outras gravações porque o PUT o trata como inalterado", async () => {
    const onSaveWhatsAppSettings = vi.fn<SaveWhatsAppSettings>(() =>
      Promise.resolve()
    );
    renderChannelSettings(
      whatsAppSettings({
        credentialsAtCloud: true,
        enabled: true,
        hasApiToken: false,
      }),
      onSaveWhatsAppSettings
    );

    const phoneInput = await screen.findByLabelText("whatsapp_phone_number_id");
    fireEvent.change(phoneInput, { target: { value: "" } });
    const [saveButton] = screen.getAllByRole("button", {
      name: "save_changes",
    });
    if (!saveButton) {
      throw new Error("save button missing");
    }
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSaveWhatsAppSettings).toHaveBeenCalled());
    expect(
      onSaveWhatsAppSettings.mock.calls[0]?.[0]?.phoneNumberId
    ).toBeUndefined();
  });
});
