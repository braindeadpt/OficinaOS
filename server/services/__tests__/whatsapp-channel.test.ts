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

const updateManySettings = vi.fn();
const prisma = {
  shopSettings: { updateMany: updateManySettings },
} as never;

import {
  maskPhone,
  pushCredentialsToCloud,
  resolveWhatsAppChannel,
  revokeWhatsAppCloudCredentials,
  sendWhatsAppTemplateVia,
  sendWhatsAppText,
} from "../whatsapp-channel.js";

// Decisão 2026-11-23: todo o WhatsApp é Pro — qualquer stub "enviável"
// precisa do entitlement "whatsapp-bot" com cache fresco (<24h).
const entitled = {
  cloudEntitlements: ["whatsapp-bot"],
  cloudSyncedAt: new Date(),
};

const pairedCloud = {
  ...entitled,
  cloudApiUrl: "https://cloud.example",
  cloudShopTokenEncrypted: "enc:shop-token",
  whatsappCredentialsAtCloud: true,
  whatsappEnabled: true,
};

describe("resolveWhatsAppChannel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when WhatsApp is disabled", () => {
    expect(
      resolveWhatsAppChannel({ ...entitled, whatsappEnabled: false })
    ).toBeNull();
  });

  it("returns null without the whatsapp-bot module — every mode blocked", () => {
    // Meta local
    expect(resolveWhatsAppChannel({ whatsappEnabled: true })).toBeNull();
    // Cloud relay — credenciais completas mas sem módulo
    expect(
      resolveWhatsAppChannel({
        cloudApiUrl: "https://cloud.example",
        cloudShopTokenEncrypted: "enc:shop-token",
        whatsappCredentialsAtCloud: true,
        whatsappEnabled: true,
      })
    ).toBeNull();
    // Evolution — disclaimer aceite mas sem módulo
    expect(
      resolveWhatsAppChannel({
        evolutionApiKeyEncrypted: "enc:evo",
        evolutionUrl: "http://evo:8080",
        whatsappEnabled: true,
        whatsappLocalDisclaimerAt: new Date(),
        whatsappTransport: "evolution",
      })
    ).toBeNull();
    // Cache velha (>24h) também conta como sem módulo
    expect(
      resolveWhatsAppChannel({
        ...pairedCloud,
        cloudSyncedAt: new Date(Date.now() - 25 * 3600 * 1000),
      })
    ).toBeNull();
  });

  it("prefers the cloud relay once credentials migrated — grandfathered without consent", () => {
    const channel = resolveWhatsAppChannel({
      ...pairedCloud,
      whatsappApiTokenEncrypted: "enc:meta",
      whatsappCloudConsentAt: null,
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
    const channel = resolveWhatsAppChannel({
      ...entitled,
      whatsappEnabled: true,
    });
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
      { ...entitled, whatsappApiTokenEncrypted: null }
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

  it("propagates the wamid returned by the cloud relay", async () => {
    // Correlação reply-quote: o relay devolve o wamid da Meta — o
    // lembrete de saída precisa que ele chegue no SendResult.
    mocks.cloudFetch.mockResolvedValue({
      body: { messageId: "wamid.HBgMNTUx", ok: true },
      ok: true,
      status: 200,
    });
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      { ...entitled, whatsappApiTokenEncrypted: null }
    );
    expect(res).toMatchObject({
      messageId: "wamid.HBgMNTUx",
      success: true,
    });
  });

  it("clears the local token after the first successful cloud send", async () => {
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    await sendWhatsAppText(prisma, channel, "+351912345678", "olá", "PT", {
      ...entitled,
      whatsappApiTokenEncrypted: "enc:meta",
    });
    expect(updateManySettings).toHaveBeenCalledWith({
      data: { whatsappApiTokenEncrypted: null },
      where: {
        id: "default",
        whatsappApiTokenEncrypted: "enc:meta",
        whatsappCredentialsAtCloud: true,
      },
    });
  });

  it.each([
    false,
    true,
  ])("does not delete a replacement token when an older cloud send finishes (cloud flag %s)", async (credentialsAtCloud) => {
    let storedToken: string | null = "enc:replacement";
    updateManySettings.mockImplementation(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        const matches =
          storedToken === where.whatsappApiTokenEncrypted &&
          credentialsAtCloud === where.whatsappCredentialsAtCloud;
        if (matches) {
          storedToken = data.whatsappApiTokenEncrypted as string | null;
        }
        return Promise.resolve({ count: matches ? 1 : 0 });
      }
    );
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });

    await sendWhatsAppText(prisma, channel, "+351912345678", "olá", "PT", {
      ...entitled,
      whatsappApiTokenEncrypted: "enc:original",
    });

    expect(storedToken).toBe("enc:replacement");
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
      { ...entitled, whatsappApiTokenEncrypted: "enc:meta" }
    );
    expect(res.success).toBe(false);
    expect(updateManySettings).not.toHaveBeenCalled();
  });

  it("reports waiting-for-cloud when unreachable", async () => {
    mocks.cloudFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      { ...entitled, whatsappApiTokenEncrypted: "enc:meta" }
    );
    expect(res).toEqual({
      error: "a aguardar ligação à cloud",
      success: false,
    });
  });

  it("fails closed when the module was revoked after resolve (defense)", async () => {
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      { cloudSyncedAt: new Date(Date.now() - 25 * 3600 * 1000) }
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("whatsapp-bot");
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("normalizes entitlement refusal", async () => {
    mocks.cloudFetch.mockResolvedValue({ body: null, ok: false, status: 402 });
    const res = await sendWhatsAppText(
      prisma,
      channel,
      "+351912345678",
      "olá",
      "PT",
      entitled
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
      entitled
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
      entitled
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
  beforeEach(() => {
    vi.clearAllMocks();
    updateManySettings.mockReset();
    updateManySettings.mockResolvedValue({ count: 1 });
  });

  // §5.6 — a migração só corre com o entitlement whatsapp-bot FRESCO
  // (isModuleEnabled <24h); sem módulo a loja nunca envia credenciais.
  const settings = {
    cloudApiUrl: "https://cloud.example",
    cloudEntitlements: ["whatsapp-bot"],
    cloudShopTokenEncrypted: "enc:shop-token",
    cloudSyncedAt: new Date(),
    whatsappApiTokenEncrypted: "enc:meta-token",
    whatsappCloudConsentAt: new Date(),
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
    expect(updateManySettings).toHaveBeenCalledWith({
      data: { whatsappCredentialsAtCloud: true },
      where: {
        id: "default",
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappPhoneNumberId: "1234",
      },
    });
  });

  it("does not flag the migration when the credentials changed during upload", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });
    // O updateMany condicional não encontrou o snapshot enviado — a loja
    // substituiu o token/phone_number_id enquanto a Cloud processava.
    updateManySettings.mockResolvedValue({ count: 0 });

    expect(await pushCredentialsToCloud(prisma)).toBe(false);
  });

  it("serializes concurrent uploads so the cloud receives the replacement last", async () => {
    let currentToken = "enc:meta-token";
    let uploadCalls = 0;
    let resolveFirst: (value: unknown) => void = () => undefined;
    const firstResponse = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    mocks.getOrCreateShopSettings.mockImplementation(() =>
      Promise.resolve({
        ...settings,
        whatsappApiTokenEncrypted: currentToken,
      })
    );
    mocks.cloudFetch.mockImplementation(() => {
      uploadCalls += 1;
      if (uploadCalls === 1) {
        return firstResponse;
      }
      return Promise.resolve({ body: { ok: true }, ok: true, status: 200 });
    });
    updateManySettings.mockImplementation(({ where }) => {
      const matches =
        currentToken === where.whatsappApiTokenEncrypted &&
        settings.whatsappPhoneNumberId === where.whatsappPhoneNumberId;
      return Promise.resolve({ count: matches ? 1 : 0 });
    });

    const first = pushCredentialsToCloud(prisma);
    await vi.waitFor(() => expect(mocks.cloudFetch).toHaveBeenCalledTimes(1));

    // A loja substitui o token enquanto o primeiro upload está em voo; a
    // segunda chamada só pode ler/enviar esse token depois da primeira acabar.
    currentToken = "enc:replacement";
    const second = pushCredentialsToCloud(prisma);
    // Sem a fila o segundo upload partia imediatamente para a Cloud — este é
    // o invariante que impede a substituição fora de ordem.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.cloudFetch).toHaveBeenCalledTimes(1);
    resolveFirst({ body: { ok: true }, ok: true, status: 200 });
    await vi.waitFor(() => expect(mocks.cloudFetch).toHaveBeenCalledTimes(2));

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    const uploadedTokens = mocks.cloudFetch.mock.calls.map(
      (call) => (call[2] as { body: { accessToken: string } }).body.accessToken
    );
    expect(uploadedTokens).toEqual(["meta-token", "replacement"]);
  });

  it("never uploads without explicit cloud consent", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...settings,
      whatsappCloudConsentAt: null,
    });
    expect(await pushCredentialsToCloud(prisma)).toBe(false);
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(updateManySettings).not.toHaveBeenCalled();
  });

  it("returns false when the cloud rejects — local send keeps working", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({ body: null, ok: false, status: 402 });
    expect(await pushCredentialsToCloud(prisma)).toBe(false);
    expect(updateManySettings).not.toHaveBeenCalled();
  });

  it("reaffirms the not-current flag on 409 instead of trapping the shop", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({
      body: { error: { code: "PHONE_NUMBER_ID_TAKEN" } },
      ok: false,
      status: 409,
    });

    expect(await pushCredentialsToCloud(prisma)).toBe(false);
    expect(updateManySettings).toHaveBeenCalledWith({
      data: { whatsappCredentialsAtCloud: false },
      where: {
        id: "default",
        whatsappApiTokenEncrypted: "enc:meta-token",
        whatsappPhoneNumberId: "1234",
      },
    });
  });

  it("never uploads without the whatsapp-bot entitlement — free stays local", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...settings,
      cloudEntitlements: [],
    });
    expect(await pushCredentialsToCloud(prisma)).toBe(false);
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(updateManySettings).not.toHaveBeenCalled();
  });

  it("is a grandfathered no-op once credentials are already at the cloud", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...settings,
      whatsappCloudConsentAt: null,
      whatsappCredentialsAtCloud: true,
    });
    expect(await pushCredentialsToCloud(prisma)).toBe(true);
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });
});

describe("revokeWhatsAppCloudCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManySettings.mockReset();
    updateManySettings.mockResolvedValue({ count: 1 });
  });

  const settings = {
    cloudApiUrl: "https://cloud.example",
    cloudShopTokenEncrypted: "enc:shop-token",
    whatsappApiTokenEncrypted: "enc:meta-token",
    whatsappCloudConsentAt: new Date("2026-01-03T10:00:00.000Z"),
  };

  it("deletes the cloud copy before wiping the local token and consent", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({
      body: { ok: true },
      ok: true,
      status: 200,
    });

    await revokeWhatsAppCloudCredentials(prisma);

    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud.example",
      "/shops/whatsapp-credentials",
      { method: "DELETE", token: "shop-token" }
    );
    expect(updateManySettings).toHaveBeenCalledWith({
      data: {
        whatsappApiTokenEncrypted: null,
        whatsappCloudConsentAt: null,
        whatsappCredentialsAtCloud: false,
      },
      where: { id: "default" },
    });
  });

  it("treats cloud 404 as idempotent success", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockResolvedValue({ body: null, ok: false, status: 404 });

    await expect(
      revokeWhatsAppCloudCredentials(prisma)
    ).resolves.toBeUndefined();
    expect(updateManySettings).toHaveBeenCalledTimes(1);
  });

  it("deletes nothing locally on cloud 5xx and the shop can retry", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch
      .mockResolvedValueOnce({ body: null, ok: false, status: 500 })
      .mockResolvedValueOnce({ body: { ok: true }, ok: true, status: 200 });

    await expect(revokeWhatsAppCloudCredentials(prisma)).rejects.toMatchObject({
      code: "CLOUD_REQUEST_FAILED",
    });
    expect(updateManySettings).not.toHaveBeenCalled();

    await expect(
      revokeWhatsAppCloudCredentials(prisma)
    ).resolves.toBeUndefined();
    expect(updateManySettings).toHaveBeenCalledTimes(1);
  });

  it("deletes nothing locally when the cloud is unreachable", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(settings);
    mocks.cloudFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(revokeWhatsAppCloudCredentials(prisma)).rejects.toMatchObject({
      code: "CLOUD_UNREACHABLE",
    });
    expect(updateManySettings).not.toHaveBeenCalled();
  });
});

describe("maskPhone", () => {
  it("masks the middle digits", () => {
    expect(maskPhone("+351912345678")).toBe("+351***5678");
    expect(maskPhone("912")).toBe("***");
  });
});
