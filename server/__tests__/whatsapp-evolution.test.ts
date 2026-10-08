import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsRoutes } from "../routes/settings.js";

const mocks = vi.hoisted(() => ({
  decryptSecret: vi.fn((payload: string) =>
    payload === "enc:key" ? "evo-key" : null
  ),
  disconnectEvolutionInstance: vi.fn(async () => ({ success: true })),
  getEvolutionState: vi.fn(async () => "open"),
  isEncrypted: vi.fn(() => true),
  pairEvolutionInstance: vi.fn(async () => ({
    pairingCode: "1234-5678",
    qrBase64: "data:image/png;base64,AAA",
  })),
  pushCredentialsToCloud: vi.fn(async () => false),
  upsertWhatsAppSettings: vi.fn(async (p: unknown) => p),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: vi.fn((v: string) => `enc:${v}`),
  isEncrypted: mocks.isEncrypted,
}));

vi.mock("../services/evolution.service.js", () => ({
  disconnectEvolutionInstance: mocks.disconnectEvolutionInstance,
  getEvolutionState: mocks.getEvolutionState,
  pairEvolutionInstance: mocks.pairEvolutionInstance,
  sendEvolutionText: vi.fn(async () => ({ success: true })),
}));

vi.mock("../services/whatsapp-channel.js", async () => {
  const actual = await vi.importActual("../services/whatsapp-channel.js");
  return { ...actual, pushCredentialsToCloud: mocks.pushCredentialsToCloud };
});

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

import { resolveWhatsAppChannel } from "../services/whatsapp-channel.js";

const EVO_ROW = {
  cloudEntitlements: ["whatsapp-bot"],
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

vi.mock("../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: vi.fn(async () => null),
  getOrCreateShopSettings: vi.fn(
    async (prisma: {
      shopSettings: { findUnique: (args: unknown) => Promise<unknown> };
    }) => await prisma.shopSettings.findUnique({ where: { id: "default" } })
  ),
}));

function buildApp(prisma: unknown) {
  const app = Fastify();
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
});

describe("resolveWhatsAppChannel — transporte evolution", () => {
  it("resolves the local channel with entitlement + disclaimer", () => {
    const channel = resolveWhatsAppChannel(EVO_ROW);
    expect(channel).toEqual({
      config: {
        apiKey: "evo-key",
        baseUrl: "http://evolution:8080",
        instance: "oficinaos",
      },
      mode: "evolution",
    });
  });

  it("returns null without the whatsapp-bot entitlement", () => {
    const channel = resolveWhatsAppChannel({
      ...EVO_ROW,
      cloudEntitlements: [],
    });
    expect(channel).toBeNull();
  });

  it("returns null without the disclaimer acceptance", () => {
    const channel = resolveWhatsAppChannel({
      ...EVO_ROW,
      whatsappLocalDisclaimerAt: null,
    });
    expect(channel).toBeNull();
  });

  it("returns null when disabled or transport is meta", () => {
    expect(
      resolveWhatsAppChannel({ ...EVO_ROW, whatsappEnabled: false })
    ).toBeNull();
    expect(
      resolveWhatsAppChannel({ ...EVO_ROW, whatsappTransport: "meta" })
    ).toBeNull();
  });

  it("returns null without URL or undecryptable key", () => {
    expect(
      resolveWhatsAppChannel({ ...EVO_ROW, evolutionUrl: null })
    ).toBeNull();
    expect(
      resolveWhatsAppChannel({
        ...EVO_ROW,
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

  it("blocks enabling local transport without whatsapp-bot module", async () => {
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
      fakePrisma({ ...EVO_ROW, whatsappLocalDisclaimerAt: null })
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

  it("enables local transport with entitlement + disclaimer", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "PUT",
      payload,
      url: "/api/settings/whatsapp",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.upsertWhatsAppSettings).toHaveBeenCalled();
  });

  it("accepts the stored disclaimer on later saves", async () => {
    const app = buildApp(fakePrisma());
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

  it("does not gate the meta transport", async () => {
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

  it("pair requires the whatsapp-bot module", async () => {
    const app = buildApp(fakePrisma({ ...EVO_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/whatsapp/evolution/pair",
    });
    expect(res.statusCode).toBe(402);
  });

  it("pair returns QR + pairing code", async () => {
    const app = buildApp(fakePrisma());
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

  it("disconnect calls logout on the instance", async () => {
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
