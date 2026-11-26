// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
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
      whatsAppSettings: null,
    }),
}));

import ChannelSettings from "../channel-settings";

type ChannelSettingsProps = ComponentProps<typeof ChannelSettings>;
type WhatsAppSettings = NonNullable<ChannelSettingsProps["whatsAppSettings"]>;

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

function renderChannelSettings(settings: WhatsAppSettings) {
  return render(
    <ChannelSettings
      onFetchWhatsAppSettings={vi.fn(() => Promise.resolve())}
      onSaveSmsSettings={vi.fn(() => Promise.resolve())}
      onSaveWhatsAppSettings={vi.fn(() => Promise.resolve())}
      onSendSmsTest={vi.fn(() => Promise.resolve({ ok: true }))}
      smsSettings={null}
      whatsAppSettings={settings}
    />
  );
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
});
