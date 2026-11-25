import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsRoutes } from "../routes/settings.js";

const mocks = vi.hoisted(() => ({
  decryptSecret: vi.fn((payload: string) =>
    payload === "enc:key" ? "evo-key" : null
  ),
  dnsLookup: vi.fn(
    (_hostname?: string): Promise<{ address: string; family: number }[]> =>
      Promise.reject(new Error("ENOTFOUND"))
  ),
  disconnectEvolutionInstance: vi.fn(async () => ({ success: true })),
  getEvolutionState: vi.fn(async () => "open"),
  hasIsolatedNetNs: vi.fn(() => false),
  isEncrypted: vi.fn(() => true),
  pairEvolutionInstance: vi.fn(async () => ({
    pairingCode: "1234-5678",
    qrBase64: "data:image/png;base64,AAA",
  })),
  primaryLanIpv4: vi.fn((): string | null => null),
  pushCredentialsToCloud: vi.fn(async () => false),
  setEvolutionWebhook: vi.fn(async () => ({ success: true })),
  syncWhatsAppTemplates: vi.fn(async () => ({})),
  upsertWhatsAppSettings: vi.fn(async (p: unknown) => p),
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.dnsLookup,
}));

vi.mock("../lib/mdns.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/mdns.js")>()),
  hasIsolatedNetNs: mocks.hasIsolatedNetNs,
  primaryLanIpv4: mocks.primaryLanIpv4,
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: vi.fn((v: string) => `enc:${v}`),
  isEncrypted: mocks.isEncrypted,
}));

vi.mock("../services/evolution.service.js", () => ({
  disconnectEvolutionInstance: mocks.disconnectEvolutionInstance,
  EVOLUTION_WEBHOOK_TOKEN_HEADER: "x-oficinaos-webhook-token",
  getEvolutionState: mocks.getEvolutionState,
  pairEvolutionInstance: mocks.pairEvolutionInstance,
  sendEvolutionText: vi.fn(async () => ({ success: true })),
  setEvolutionWebhook: mocks.setEvolutionWebhook,
}));

vi.mock("../services/whatsapp-channel.js", async () => {
  const actual = await vi.importActual("../services/whatsapp-channel.js");
  return { ...actual, pushCredentialsToCloud: mocks.pushCredentialsToCloud };
});

vi.mock("../services/whatsapp-templates.service.js", () => ({
  getWhatsAppTemplateStatuses: vi.fn(async () => ({})),
  syncWhatsAppTemplates: mocks.syncWhatsAppTemplates,
}));

vi.mock("../services/settings.service.js", () => ({
  getAiSettings: vi.fn(async () => ({})),
  getInvoicingSettings: vi.fn(async () => ({})),
  getShopSettings: vi.fn(async () => ({})),
  getSmsSettings: vi.fn(async () => ({})),
  getWhatsAppSettings: vi.fn(async () => ({})),
  testAiConnection: vi.fn(async () => ({ ok: true })),
  upsertAiSettings: vi.fn(async () => ({})),
  upsertInvoicingSettings: vi.fn(async () => ({})),
  upsertShopSettings: vi.fn(async () => ({})),
  upsertSmsSettings: vi.fn(async () => ({})),
  upsertWhatsAppSettings: mocks.upsertWhatsAppSettings,
}));

vi.mock("../services/cloud.service.js", () => ({
  getCloudStatus: vi.fn(async () => ({})),
  pairWithCloud: vi.fn(async () => ({})),
  syncCloudEntitlements: vi.fn(async () => []),
  unpairCloud: vi.fn(async () => ({})),
}));

vi.mock("../services/app-version.service.js", () => ({
  getAppVersionInfo: vi.fn(async () => ({})),
}));

vi.mock("../services/backup-status.service.js", () => ({
  getBackupStatus: vi.fn(async () => ({})),
}));

vi.mock("../services/escpos.service.js", () => ({
  buildTestTicketEscPos: vi.fn(() => new Uint8Array()),
  sendToPrinter: vi.fn(() => Promise.resolve()),
}));

vi.mock("../services/update.service.js", () => ({
  getUpdateState: vi.fn(async () => ({})),
  startUpdate: vi.fn(async () => ({})),
}));

import { resetEnvForTests } from "../config/env.js";
import { resolveWhatsAppChannel } from "../services/whatsapp-channel.js";

const EVO_ROW = {
  // No entitlements on purpose — desde 2026-11-23 todo o WhatsApp é Pro;
  // testes que exercitam o caminho Pro usam PRO_EVO_ROW.
  cloudEntitlements: [],
  evolutionApiKeyEncrypted: "enc:key",
  evolutionInstance: "oficinaos",
  evolutionUrl: "http://evolution:8080",
  whatsappEnabled: true,
  whatsappLocalDisclaimerAt: new Date("2026-01-01"),
  whatsappTransport: "evolution",
};

function fakePrisma(row: Record<string, unknown> = EVO_ROW) {
  return {
    shopSettings: {
      findUnique: vi.fn(async () => ({ ...row })),
      upsert: vi.fn(
        async ({ create, update }: { create: object; update: object }) => ({
          ...create,
          ...row,
          ...update,
        })
      ),
    },
  };
}

const PRO_EVO_ROW = {
  ...EVO_ROW,
  cloudEntitlements: ["whatsapp-bot"],
  cloudSyncedAt: new Date(),
};

vi.mock("../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: vi.fn(async () => null),
  getOrCreateShopSettings: vi.fn(
    async (prisma: {
      shopSettings: { findUnique: (args: unknown) => Promise<unknown> };
    }) => await prisma.shopSettings.findUnique({ where: { id: "default" } })
  ),
}));

function buildApp(prisma: unknown, options?: { trustProxy?: boolean }) {
  const app = Fastify({ trustProxy: options?.trustProxy ?? false });
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return;
    }
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });
  app.decorate("auth", {
    api: {
      userHasPermission: () => Promise.resolve({ error: null, success: true }),
    },
  } as never);
  app.decorate("prisma", prisma as never);
  app.decorate("wsBroadcast", vi.fn() as never);
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = { id: "u1", role: "OWNER" };
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(settingsRoutes, { prefix: "/api/settings" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasIsolatedNetNs.mockReturnValue(false);
  mocks.primaryLanIpv4.mockReturnValue(null);
  mocks.dnsLookup.mockRejectedValue(new Error("ENOTFOUND"));
  delete process.env.APP_URL;
  resetEnvForTests();
});

describe("resolveWhatsAppChannel — transporte evolution", () => {
  it("returns null without the whatsapp-bot module (Pro since 2026-11-23)", () => {
    expect(resolveWhatsAppChannel(EVO_ROW)).toBeNull();
  });

  it("resolves the local channel with module + disclaimer accepted", () => {
    const channel = resolveWhatsAppChannel(PRO_EVO_ROW);
    expect(channel).toEqual({
      config: {
        apiKey: "evo-key",
        baseUrl: "http://evolution:8080",
        instance: "oficinaos",
      },
      mode: "evolution",
    });
  });

  it("returns null without the disclaimer acceptance", () => {
    const channel = resolveWhatsAppChannel({
      ...PRO_EVO_ROW,
      whatsappLocalDisclaimerAt: null,
    });
    expect(channel).toBeNull();
  });

  it("returns null when disabled or transport is meta", () => {
    expect(
      resolveWhatsAppChannel({ ...PRO_EVO_ROW, whatsappEnabled: false })
    ).toBeNull();
    expect(
      resolveWhatsAppChannel({ ...PRO_EVO_ROW, whatsappTransport: "meta" })
    ).toBeNull();
  });

  it("returns null without URL or undecryptable key", () => {
    expect(
      resolveWhatsAppChannel({ ...PRO_EVO_ROW, evolutionUrl: null })
    ).toBeNull();
    expect(
      resolveWhatsAppChannel({
        ...PRO_EVO_ROW,
        evolutionApiKeyEncrypted: "bad",
      })
    ).toBeNull();
  });
});

describe("PUT /api/settings/whatsapp — gates evolution", () => {
  const payload = {
    disclaimerAccepted: true,
    enabled: true,
    evolutionApiKey: "k",
    evolutionInstance: "oficinaos",
    evolutionUrl: "http://evolution:8080",
    transport: "evolution",
  };

  it("rejects enabling without the whatsapp-bot module → 402", async () => {
    // Decisão 2026-11-23: grátis não envia nada — nem pela Evolution.
    const app = buildApp(fakePrisma({ ...EVO_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "PUT",
      payload,
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.upsertWhatsAppSettings).not.toHaveBeenCalled();
  });

  it("requires the disclaimer when enabling local transport", async () => {
    const app = buildApp(
      fakePrisma({ ...PRO_EVO_ROW, whatsappLocalDisclaimerAt: null })
    );
    const res = await app.inject({
      method: "PUT",
      payload: { ...payload, disclaimerAccepted: false },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(mocks.upsertWhatsAppSettings).not.toHaveBeenCalled();
  });

  it("enables local transport with module + disclaimer accepted", async () => {
    const app = buildApp(fakePrisma(PRO_EVO_ROW));
    const res = await app.inject({
      method: "PUT",
      payload,
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.upsertWhatsAppSettings).toHaveBeenCalled();
  });

  it("accepts the stored disclaimer on later saves", async () => {
    const app = buildApp(fakePrisma(PRO_EVO_ROW));
    const res = await app.inject({
      method: "PUT",
      payload: { ...payload, disclaimerAccepted: undefined },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects remarketing on the local transport (Meta templates only)", async () => {
    const app = buildApp(
      fakePrisma({
        ...EVO_ROW,
        cloudEntitlements: ["whatsapp-bot", "remarketing"],
        cloudSyncedAt: new Date(),
      })
    );
    const res = await app.inject({
      method: "PUT",
      payload: { ...payload, remarketingEnabled: true },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.upsertWhatsAppSettings).not.toHaveBeenCalled();
  });

  it("trackingBaseUrl sozinho (gravação parcial) re-sincroniza os templates — só em cloud", async () => {
    // O formulário grava enabled+URL juntos, mas a condicional {{if}} do
    // corpo Meta depende do URL — uma gravação parcial só com o URL (ou
    // a string vazia que o remove) tem de disparar o re-sync na mesma.
    // O re-sync só corre quando o canal resolve para cloud (Pro).
    const cloudRow = {
      ...PRO_EVO_ROW,
      cloudApiUrl: "https://cloud.example",
      cloudShopTokenEncrypted: "enc:key",
      whatsappCredentialsAtCloud: true,
      whatsappTransport: "meta",
    };
    const app = buildApp(fakePrisma(cloudRow));
    const res = await app.inject({
      method: "PUT",
      payload: { trackingBaseUrl: "https://loja.example.com" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.syncWhatsAppTemplates).toHaveBeenCalledOnce();

    mocks.syncWhatsAppTemplates.mockClear();
    const res2 = await app.inject({
      method: "PUT",
      payload: { trackingBaseUrl: "" },
      url: "/api/settings/whatsapp",
    });
    expect(res2.statusCode).toBe(200);
    expect(mocks.syncWhatsAppTemplates).toHaveBeenCalledOnce();
  });

  it("não re-sincroniza templates fora do modo cloud (evolution/local)", async () => {
    // enabled ou trackingBaseUrl não disparam sync fora do modo cloud.
    const app = buildApp(fakePrisma(PRO_EVO_ROW));
    for (const payload of [
      { enabled: true, transport: "evolution", disclaimerAccepted: true },
      { trackingBaseUrl: "https://loja.example.com" },
    ]) {
      const res = await app.inject({
        method: "PUT",
        payload,
        url: "/api/settings/whatsapp",
      });
      expect(res.statusCode).toBe(200);
    }
    expect(mocks.syncWhatsAppTemplates).not.toHaveBeenCalled();
  });

  it("gravação sem URL nem enabled não re-sincroniza templates", async () => {
    const app = buildApp(fakePrisma(PRO_EVO_ROW));
    const res = await app.inject({
      method: "PUT",
      payload: { pickupReminderTemplate: "default" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.syncWhatsAppTemplates).not.toHaveBeenCalled();
  });

  it("meta transport is also Pro — enabling without module → 402", async () => {
    const app = buildApp(
      fakePrisma({
        ...EVO_ROW,
        cloudEntitlements: [],
        whatsappTransport: "meta",
      })
    );
    const res = await app.inject({
      method: "PUT",
      payload: { enabled: true, transport: "meta" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("meta transport enables with the whatsapp-bot module", async () => {
    const app = buildApp(
      fakePrisma({ ...PRO_EVO_ROW, whatsappTransport: "meta" })
    );
    const res = await app.inject({
      method: "PUT",
      payload: { enabled: true, transport: "meta" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Evolution pairing/status routes", () => {
  it("status returns unconfigured without URL+key", async () => {
    const app = buildApp(fakePrisma({ ...EVO_ROW, evolutionUrl: null }));
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp/evolution/status",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("unconfigured");
  });

  it("status proxies the live Evolution state", async () => {
    mocks.getEvolutionState.mockResolvedValue("connecting");
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/whatsapp/evolution/status",
    });
    expect(res.json().state).toBe("connecting");
  });

  it("pair without the whatsapp-bot entitlement → 402 (Pro transport)", async () => {
    const app = buildApp(fakePrisma({ ...EVO_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/evolution/pair",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.pairEvolutionInstance).not.toHaveBeenCalled();
  });

  it("pair returns QR + pairing code", async () => {
    const app = buildApp(fakePrisma(PRO_EVO_ROW));
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/evolution/pair",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.qrBase64).toContain("data:image");
    expect(body.pairingCode).toBe("1234-5678");
  });

  it("disconnect calls logout on the instance — teardown stays free", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/evolution/disconnect",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.disconnectEvolutionInstance).toHaveBeenCalledWith({
      apiKey: "evo-key",
      baseUrl: "http://evolution:8080",
      instance: "oficinaos",
    });
  });
});

describe("Evolution inbound webhook registration (MESSAGES_UPSERT)", () => {
  const BOT_ROW = {
    ...EVO_ROW,
    evolutionWebhookToken: "evo-tok",
    whatsappBotDisclaimerAt: new Date("2026-01-01"),
  };

  const PRO_BOT_ROW = {
    ...BOT_ROW,
    cloudEntitlements: ["whatsapp-bot"],
    cloudSyncedAt: new Date(),
  };

  /** PUT /settings/whatsapp com transporte evolution — dispara o registo
   *  do webhook (botDisclaimerAccepted ou transport=evolution). */
  async function saveWhatsApp(host: string) {
    const app = buildApp(fakePrisma(PRO_BOT_ROW));
    return await app.inject({
      headers: { host },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
  }

  const lastWebhookCall = () =>
    mocks.setEvolutionWebhook.mock.calls.at(-1) as
      | [
          { apiKey: string; baseUrl: string; instance: string },
          { headers?: Record<string, string>; url: string },
        ]
      | undefined;

  it("registers the webhook when whatsapp-bot is entitled", async () => {
    const res = await saveWhatsApp("192.168.1.10:4000");
    expect(res.statusCode).toBe(200);
    expect(mocks.setEvolutionWebhook).toHaveBeenCalledWith(
      {
        apiKey: "evo-key",
        baseUrl: "http://evolution:8080",
        instance: "oficinaos",
      },
      {
        // O segredo vai no header — nunca no path (Finding ronda 2).
        headers: { "x-oficinaos-webhook-token": "evo-tok" },
        url: "http://192.168.1.10:4000/api/public/whatsapp/evolution/inbound",
      }
    );
  });

  it("localhost com IP LAN → callback no IP LAN real (porta do pedido)", async () => {
    // Single-PC: o staff abre localhost mas a Evolution noutro PC da
    // LAN não resolve esse nome — o IPv4 LAN é o endereço alcançável.
    mocks.primaryLanIpv4.mockReturnValue("192.168.1.20");
    const res = await saveWhatsApp("localhost:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://192.168.1.20:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("localhost sem IP LAN + APP_URL → callback na APP_URL configurada", async () => {
    // Contentor com netns isolado (Docker): nem localhost nem IP LAN
    // servem — a APP_URL pública é a única morada alcançável.
    mocks.primaryLanIpv4.mockReturnValue(null);
    process.env.APP_URL = "https://oficinaos.example.com";
    resetEnvForTests();
    const res = await saveWhatsApp("localhost:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficinaos.example.com/api/public/whatsapp/evolution/inbound"
    );
  });

  it("localhost sem IP LAN nem APP_URL em netns isolado → fallback docker app:PORT", async () => {
    // wa-local: app e Evolution na mesma network do compose — o nome do
    // serviço é alcançável mesmo sem IP LAN nem domínio configurado.
    mocks.primaryLanIpv4.mockReturnValue(null);
    mocks.hasIsolatedNetNs.mockReturnValue(true);
    const res = await saveWhatsApp("localhost:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://app:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("localhost sem rede nenhuma → não regista (sem URL alcançável)", async () => {
    mocks.primaryLanIpv4.mockReturnValue(null);
    mocks.hasIsolatedNetNs.mockReturnValue(false);
    const res = await saveWhatsApp("localhost:4000");
    expect(res.statusCode).toBe(200);
    expect(mocks.setEvolutionWebhook).not.toHaveBeenCalled();
  });

  it("«localhost.evil.com» NÃO é loopback — HTTPS (prefixo enganoso)", async () => {
    // Regressão SEC: o teste de loopback por prefixo tratava qualquer
    // nome começado por «localhost» como interno e o token do webhook
    // seguia em HTTP claro para um host público.
    const res = await saveWhatsApp("localhost.evil.com");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://localhost.evil.com/api/public/whatsapp/evolution/inbound"
    );
  });

  it("«127.evil.com» NÃO é loopback — HTTPS (prefixo enganoso)", async () => {
    const res = await saveWhatsApp("127.evil.com");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://127.evil.com/api/public/whatsapp/evolution/inbound"
    );
  });

  it("127.0.0.1 continua loopback — substitui pelo IP LAN", async () => {
    mocks.primaryLanIpv4.mockReturnValue("192.168.1.20");
    const res = await saveWhatsApp("127.0.0.1:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://192.168.1.20:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("APP_URL em HTTPS nunca desce para HTTP mesmo com host privado", async () => {
    // O esquema derivado do host rebaixava a APP_URL configurada — a
    // loja declarou TLS e o token não pode descer para HTTP.
    mocks.primaryLanIpv4.mockReturnValue(null);
    process.env.APP_URL = "https://192.168.1.10:4000";
    resetEnvForTests();
    const res = await saveWhatsApp("localhost:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://192.168.1.10:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("host público → callback em HTTPS (token não viaja em claro)", async () => {
    const res = await saveWhatsApp("oficinaos.example.com");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficinaos.example.com/api/public/whatsapp/evolution/inbound"
    );
  });

  it("hostname com ponto a resolver só para IPs privados → HTTP (LAN com DNS próprio)", async () => {
    // «oficina.exemplo» tem ponto → isPrivateCallbackHost trata-o como
    // público, mas o DNS interno só devolve IPs da LAN — o token viaja
    // em HTTP trusted-LAN como qualquer outro host privado.
    mocks.dnsLookup.mockResolvedValue([
      { address: "192.168.1.30", family: 4 },
      { address: "fd00::1", family: 6 },
    ]);
    const res = await saveWhatsApp("oficina.exemplo");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("hostname com ponto a resolver IP público → HTTPS (um público chega)", async () => {
    mocks.dnsLookup.mockResolvedValue([
      { address: "192.168.1.30", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);
    const res = await saveWhatsApp("oficina.exemplo");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("IPv6 público vindo do DNS → HTTPS (dns.lookup não usa parênteses)", async () => {
    // Regressão SEC da revisão: lookup devolve "2001:..." sem "[]"; sem
    // normalizar antes de isPublicIpv6, o IPv6 público passava por privado.
    mocks.dnsLookup.mockResolvedValue([
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
    const res = await saveWhatsApp("oficina.exemplo");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("Evolution num nome DNS interno permite HTTP inferido na app", async () => {
    mocks.dnsLookup.mockImplementation((hostname?: string) =>
      Promise.resolve(
        hostname === "evolution.loja.interna"
          ? [{ address: "192.168.1.50", family: 4 }]
          : [{ address: "192.168.1.30", family: 4 }]
      )
    );
    const app = buildApp(
      fakePrisma({
        ...PRO_BOT_ROW,
        evolutionUrl: "http://evolution.loja.interna:8080",
      })
    );
    const res = await app.inject({
      headers: { host: "oficina.exemplo" },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("X-Forwarded-Host externo preserva o par HTTPS", async () => {
    const app = buildApp(fakePrisma(PRO_BOT_ROW), { trustProxy: true });
    const res = await app.inject({
      headers: {
        host: "app:4000",
        "x-forwarded-host": "oficina.exemplo",
        "x-forwarded-proto": "https",
      },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("HTTPS com Host interno reescrito cai no IP LAN alcançável", async () => {
    mocks.primaryLanIpv4.mockReturnValue("192.168.1.20");
    const app = buildApp(fakePrisma(PRO_BOT_ROW), { trustProxy: true });
    const res = await app.inject({
      headers: {
        host: "app:4000",
        "x-forwarded-proto": "https",
      },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://192.168.1.20:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("HTTPS com Host interno e sem IP LAN usa APP_URL como par explícito", async () => {
    process.env.APP_URL = "https://oficina.exemplo";
    resetEnvForTests();
    const app = buildApp(fakePrisma(PRO_BOT_ROW), { trustProxy: true });
    const res = await app.inject({
      headers: {
        host: "app:4000",
        "x-forwarded-proto": "https",
      },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("APP_URL HTTPS no mesmo hostname vence o DNS privado", async () => {
    // Instalação HTTPS-only dentro da LAN: a configuração explícita da
    // loja não pode ser rebaixada só porque o nome resolve um IP privado.
    mocks.dnsLookup.mockResolvedValue([{ address: "192.168.1.30", family: 4 }]);
    process.env.APP_URL = "https://oficina.exemplo";
    resetEnvForTests();
    const res = await saveWhatsApp("oficina.exemplo");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("APP_URL HTTPS noutra porta não rebaixa o acesso HTTP direto da LAN", async () => {
    // O virtual host TLS pode viver na 443 enquanto a app responde em
    // HTTP na 4000; só o mesmo host[:port] herda o esquema da APP_URL.
    mocks.dnsLookup.mockResolvedValue([{ address: "192.168.1.30", family: 4 }]);
    process.env.APP_URL = "https://oficina.exemplo";
    resetEnvForTests();
    const res = await saveWhatsApp("oficina.exemplo:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://oficina.exemplo:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("pedido HTTPS através de proxy confiável vence o DNS privado", async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: "192.168.1.30", family: 4 }]);
    const app = buildApp(fakePrisma(PRO_BOT_ROW), { trustProxy: true });
    const res = await app.inject({
      headers: {
        host: "oficina.exemplo",
        "x-forwarded-proto": "https",
      },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("Evolution fora da LAN não aceita HTTP inferido pelo DNS da app", async () => {
    mocks.dnsLookup.mockImplementation((hostname?: string) =>
      Promise.resolve(
        hostname === "evolution.example.com"
          ? [{ address: "8.8.8.8", family: 4 }]
          : [{ address: "192.168.1.30", family: 4 }]
      )
    );
    const app = buildApp(
      fakePrisma({
        ...PRO_BOT_ROW,
        evolutionUrl: "https://evolution.example.com",
      })
    );
    const res = await app.inject({
      headers: { host: "oficina.exemplo" },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficina.exemplo/api/public/whatsapp/evolution/inbound"
    );
  });

  it("sem consumidor Evolution, não resolve DNS nem regista webhook", async () => {
    const app = buildApp(
      fakePrisma({
        ...BOT_ROW,
        cloudEntitlements: [],
        cloudSyncedAt: new Date(),
      })
    );
    const res = await app.inject({
      headers: { host: "oficina.exemplo" },
      method: "PUT",
      payload: { transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.setEvolutionWebhook).not.toHaveBeenCalled();
    expect(mocks.dnsLookup).not.toHaveBeenCalled();
  });

  it("host público com porta → HTTPS preserva a porta explícita", async () => {
    const res = await saveWhatsApp("oficinaos.example.com:8443");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "https://oficinaos.example.com:8443/api/public/whatsapp/evolution/inbound"
    );
  });

  it("host .local (mDNS) → HTTP — continua LAN/trusted", async () => {
    const res = await saveWhatsApp("oficinaos.local:4000");
    expect(res.statusCode).toBe(200);
    expect(lastWebhookCall()?.[1].url).toBe(
      "http://oficinaos.local:4000/api/public/whatsapp/evolution/inbound"
    );
  });

  it("skips registration without the whatsapp-bot entitlement — a stale disclaimer does not keep it alive", async () => {
    const app = buildApp(
      fakePrisma({
        ...BOT_ROW,
        cloudEntitlements: [],
        cloudSyncedAt: new Date(),
      })
    );
    // Sem botDisclaimerAccepted: a gravação passa (não ativa o bot) e o
    // registo interno do webhook salta por falta de entitlement.
    const res = await app.inject({
      headers: { host: "192.168.1.10:4000" },
      method: "PUT",
      payload: { transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.setEvolutionWebhook).not.toHaveBeenCalled();
  });

  it("rejects accepting the bot term without the module → 402", async () => {
    const app = buildApp(
      fakePrisma({
        ...BOT_ROW,
        cloudEntitlements: [],
        cloudSyncedAt: new Date(),
      })
    );
    const res = await app.inject({
      headers: { host: "192.168.1.10:4000" },
      method: "PUT",
      payload: { botDisclaimerAccepted: true, transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.setEvolutionWebhook).not.toHaveBeenCalled();
  });

  it("skips registration when the entitlement cache is stale (>24h)", async () => {
    const app = buildApp(
      fakePrisma({
        ...BOT_ROW,
        cloudEntitlements: ["whatsapp-bot"],
        cloudSyncedAt: new Date(Date.now() - 25 * 3600 * 1000),
      })
    );
    const res = await app.inject({
      headers: { host: "192.168.1.10:4000" },
      method: "PUT",
      payload: { transport: "evolution" },
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.setEvolutionWebhook).not.toHaveBeenCalled();
  });
});
