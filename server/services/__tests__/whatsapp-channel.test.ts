import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
  decryptSecret: vi.fn((v: string) => (v.startsWith("enc:") ? v.slice(4) : v)),
  decryptWhatsAppConfig: vi.fn(),
  formatPhone: vi.fn((to: string) => (to.startsWith("+") ? to : `+351${to}`)),
  getOrCreateShopSettings: vi.fn(),
  isEncrypted: vi.fn((v: string) => v.startsWith("enc:")),
  sendWhatsApp: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
}));

vi.mock("../../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
  isEncrypted: mocks.isEncrypted,
}));

vi.mock("../cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
}));

vi.mock("../notification-sender.js", () => ({
  decryptWhatsAppConfig: mocks.decryptWhatsAppConfig,
  formatPhone: mocks.formatPhone,
  sendWhatsApp: mocks.sendWhatsApp,
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

const updateSettings = vi.fn();
const prisma = { shopSettings: { update: updateSettings } } as never;

import {
  maskPhone,
  pushCredentialsToCloud,
  resolveWhatsAppChannel,
  sendWhatsAppTemplateVia,
  sendWhatsAppText,
} from "../whatsapp-channel.js";

const pairedCloud = {
  cloudApiUrl: "https://cloud.example",
  cloudShopTokenEncrypted: "enc:shop-token",
  whatsappCredentialsAtCloud: true,
  whatsappEnabled: true,
};

describe("resolveWhatsAppChannel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when WhatsApp is disabled", () => {
    expect(resolveWhatsAppChannel({ whatsappEnabled: false })).toBeNull();
  });

  it("prefers the cloud relay once credentials migrated", () => {
    const channel = resolveWhatsAppChannel({
      ...pairedCloud,
      whatsappApiTokenEncrypted: "enc:meta",
    });
    expect(channel).toEqual({
      apiUrl: "https://cloud.example",
      mode: "cloud",
      shopToken: "shop-token",
    });
    expect(mocks.decryptWhatsAppConfig).not.toHaveBeenCalled();
  });

  it("falls back to the local token before migration", () => {
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "meta-tok",
      businessId: "b",
      phoneNumberId: "p",
    });
    const channel = resolveWhatsAppChannel({ whatsappEnabled: true });
    expect(channel?.mode).toBe("local");
  });
});

describe("sendWhatsAppText", () => {
  beforeEach(() => vi.clearAllMocks());

  const channel = {
    apiUrl: "https://cloud.example",
    mode: "cloud" as const,
    shopToken: "shop-token",
  };

  it("sends via the cloud relay with a formatted number", async () => {
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "912345678",
      "olá",
      "PT",
      { whatsappApiTokenEncrypted: null }
    );
    expect(res.success).toBe(true);
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud.example",
      "/whatsapp/send",
      expect.objectContaining({
        body: { text: "olá", to: "+351912345678" },
        method: "POST",
        token: "shop-token",
      })
    );
  });

  it("clears the local token after the first successful cloud send", async () => {
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    await sendWhatsAppText(prisma, channel, "+351912345678", "olá", "PT", {
      whatsappApiTokenEncrypted: "enc:meta",
    });
    expect(updateSettings).toHaveBeenCalledWith({
      data: { whatsappApiTokenEncrypted: null },
      where: { id: "default" },
    });
  });

  it("keeps the local token when the cloud send fails", async () => {
    mocks.cloudFetch.mockResolvedValue({
      body: { error: { message: "no" } },
      ok: false,
      status: 502,
    });
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      { whatsappApiTokenEncrypted: "enc:meta" }
    );
    expect(res.success).toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("reports waiting-for-cloud when unreachable", async () => {
    mocks.cloudFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      { whatsappApiTokenEncrypted: "enc:meta" }
    );
    expect(res).toEqual({
      error: "a aguardar ligação à cloud",
      success: false,
    });
  });

  it("normalizes entitlement refusal", async () => {
    mocks.cloudFetch.mockResolvedValue({ body: null, ok: false, status: 402 });
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      null
    );
    expect(res.error).toContain("subscrição");
  });
});

describe("sendWhatsAppTemplateVia", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends template payloads through the relay", async () => {
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    await sendWhatsAppTemplateVia(
      prisma,
      { apiUrl: "https://c", mode: "cloud", shopToken: "t" },
      "912345678",
      "oficinaos_ready",
      "pt_PT",
      ["Ana", "Loja"],
      "PT",
      null
    );
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://c",
      "/whatsapp/send",
      expect.objectContaining({
        body: {
          template: {
            language: "pt_PT",
            name: "oficinaos_ready",
            params: ["Ana", "Loja"],
          },
          to: "+351912345678",
        },
      })
    );
  });

  it("uses the local sender in legacy mode", async () => {
    mocks.sendWhatsAppTemplate.mockResolvedValue({ success: true });
    const config = { apiToken: "t", businessId: "b", phoneNumberId: "p" };
    await sendWhatsAppTemplateVia(
      prisma,
      { config, mode: "local" },
      "+351912345678",
      "tpl",
      "pt_PT",
      [],
      "PT",
      null
    );
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      config,
      "+351912345678",
      "tpl",
      "pt_PT",
      [],
      "PT"
    );
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });
});

describe("pushCredentialsToCloud", () => {
  beforeEach(() => vi.clearAllMocks());

  const settings = {
    cloudApiUrl: "https://cloud.example",
    cloudShopTokenEncrypted: "enc:shop-token",
    whatsappApiTokenEncrypted: "enc:meta-token",
    whatsappCredentialsAtCloud: false,
    whatsappPhoneNumberId: "1234",
  };

  it("uploads the decrypted token and flags the migration", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    expect(await pushCredentialsToCloud(prisma)).toBe(true);
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud.example",
      "/shops/whatsapp-credentials",
      expect.objectContaining({
        body: { accessToken: "meta-token", phoneNumberId: "1234" },
        method: "POST",
      })
    );
    expect(updateSettings).toHaveBeenCalledWith({
      data: { whatsappCredentialsAtCloud: true },
      where: { id: "default" },
    });
  });

  it("returns false when the cloud rejects — local send keeps working", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({ body: null, ok: false, status: 402 });
    expect(await pushCredentialsToCloud(prisma)).toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("is a no-op once credentials are already at the cloud", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...settings,
      whatsappCredentialsAtCloud: true,
    });
    expect(await pushCredentialsToCloud(prisma)).toBe(true);
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });
});

describe("maskPhone", () => {
  it("masks the middle digits", () => {
    expect(maskPhone("+351912345678")).toBe("+351***5678");
    expect(maskPhone("912")).toBe("***");
  });
});
