import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicRoutes } from "../routes/public.js";
import { settingsRoutes } from "../routes/settings.js";

const mocks = vi.hoisted(() => ({
  checkSmsGateway: vi.fn(),
  decryptSmsConfig: vi.fn(),
  getSmsSettings: vi.fn(),
  handleInboundSms: vi.fn(),
  sendSms: vi.fn(),
  upsertSmsSettings: vi.fn(),
}));

vi.mock("../services/sms.service.js", () => ({
  checkSmsGateway: mocks.checkSmsGateway,
  decryptSmsConfig: mocks.decryptSmsConfig,
  handleInboundSms: mocks.handleInboundSms,
  sendSms: mocks.sendSms,
}));

vi.mock("../services/settings.service.js", () => ({
  getAiSettings: vi.fn(async () => ({})),
  getInvoicingSettings: vi.fn(async () => ({})),
  getShopSettings: vi.fn(async () => ({})),
  getSmsSettings: mocks.getSmsSettings,
  getWhatsAppSettings: vi.fn(async () => ({})),
  testAiConnection: vi.fn(async () => ({ ok: true })),
  upsertAiSettings: vi.fn(async () => ({})),
  upsertInvoicingSettings: vi.fn(async () => ({})),
  upsertShopSettings: vi.fn(async () => ({})),
  upsertSmsSettings: mocks.upsertSmsSettings,
  upsertWhatsAppSettings: vi.fn(async () => ({})),
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

vi.mock("../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: vi.fn(async () => null),
  getOrCreateShopSettings: vi.fn(
    async (prisma: {
      shopSettings: { findUnique: (args: unknown) => Promise<unknown> };
    }) => await prisma.shopSettings.findUnique({ where: { id: "default" } })
  ),
}));

const SMS_ROW = {
  cloudEntitlements: ["sms"],
  cloudSyncedAt: new Date(),
  smsEnabled: true,
  smsGatewayPasswordEncrypted: "v1:enc",
  smsGatewayUrl: "http://192.168.1.50:8080",
  smsGatewayUser: "sms",
  smsWebhookToken: "tok-abc",
};

function fakePrisma(row: Record<string, unknown> = SMS_ROW) {
  return {
    customer: {
      // O remetente dos testes é +351912345678 — o match real de
      // revokeConsentForPhone filtra por sufixo; devolver esta ficha
      // faz-a casar como na BD.
      findMany: vi.fn(async () => [
        { id: "c1", name: "Ana", phone: "+351912345678" },
      ]),
      update: vi.fn(async () => ({})),
    },
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

function buildApp(
  prisma: unknown,
  user: { id: string; role: string } | null = { id: "u1", role: "OWNER" }
) {
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
    (req as { user: unknown }).user = user;
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(settingsRoutes, { prefix: "/api/settings" });
  app.register(publicRoutes, { prefix: "/api/public" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/settings/sms", () => {
  it("enables the local gateway (Pro — módulo sms)", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    mocks.decryptSmsConfig.mockReturnValue(null);
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "PUT",
      payload: {
        enabled: true,
        gatewayPassword: "x",
        gatewayUrl: "http://192.168.1.50:8080",
        gatewayUser: "sms",
      },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.upsertSmsSettings).toHaveBeenCalled();
  });

  it("rejects without the sms entitlement → 402 (decisão 2026-11-23)", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    const app = buildApp(fakePrisma({ ...SMS_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "PUT",
      payload: {
        enabled: true,
        gatewayPassword: "x",
        gatewayUrl: "http://192.168.1.50:8080",
        gatewayUser: "sms",
      },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.upsertSmsSettings).not.toHaveBeenCalled();
  });

  it("rejects even disabling without the entitlement → 402", async () => {
    // O endpoint é todo Pro — a flag fica inerte sem módulo (o outbox
    // já não envia), por isso nem a gravação passa.
    mocks.getSmsSettings.mockResolvedValue({ enabled: false });
    const app = buildApp(fakePrisma({ ...SMS_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "PUT",
      payload: { enabled: false },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.upsertSmsSettings).not.toHaveBeenCalled();
  });

  it("rejects when the entitlement cache is stale (>24h) → 402", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    const app = buildApp(
      fakePrisma({
        ...SMS_ROW,
        cloudSyncedAt: new Date(Date.now() - 25 * 3600 * 1000),
      })
    );
    const res = await app.inject({
      method: "PUT",
      payload: {
        enabled: true,
        gatewayUrl: "http://192.168.1.50:8080",
      },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("does not register any inbound webhook when saving", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    mocks.decryptSmsConfig.mockReturnValue({
      password: "p",
      url: "http://192.168.1.50:8080",
      user: "sms",
    });
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      headers: { host: "192.168.1.10:4000" },
      method: "PUT",
      payload: {
        enabled: true,
        gatewayUrl: "http://192.168.1.50:8080",
        gatewayUser: "sms",
      },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().webhookRegistered).toBeUndefined();
  });
});

describe("POST /api/settings/sms/test", () => {
  it("rejects the test without the sms entitlement → 402", async () => {
    // O teste envia uma mensagem real — todo o SMS é Pro.
    mocks.decryptSmsConfig.mockReturnValue({
      password: "p",
      url: "http://192.168.1.50:8080",
      user: "sms",
    });
    mocks.sendSms.mockResolvedValue({ success: true });
    const app = buildApp(fakePrisma({ ...SMS_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "POST",
      payload: { phone: "912345678" },
      url: "/api/settings/sms/test",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });

  it("fails cleanly when the gateway is not configured", async () => {
    mocks.decryptSmsConfig.mockReturnValue(null);
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: { phone: "912345678" },
      url: "/api/settings/sms/test",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("SMS_NOT_CONFIGURED");
  });

  it("sends via the gateway when configured", async () => {
    mocks.decryptSmsConfig.mockReturnValue({
      password: "p",
      url: "http://192.168.1.50:8080",
      user: "sms",
    });
    mocks.sendSms.mockResolvedValue({ success: true });
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: { phone: "912345678" },
      url: "/api/settings/sms/test",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://192.168.1.50:8080" }),
      "912345678",
      expect.stringContaining("OficinaOS"),
      "PT"
    );
  });
});

describe("POST /api/public/sms/inbound/:token", () => {
  const inboundPayload = {
    event: "sms:received",
    id: "evt-1",
    payload: {
      messageId: "m1",
      phoneNumber: "+351912345678",
      sender: "+351912345678",
      simNumber: 1,
      message: "estado?",
      receivedAt: "2026-10-15T10:00:00Z",
      recipient: "+351900000000",
    },
  };

  it("404s on a wrong or missing webhook token", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: inboundPayload,
      url: "/api/public/sms/inbound/wrong-token",
    });
    expect(res.statusCode).toBe(404);
    expect(mocks.handleInboundSms).not.toHaveBeenCalled();
  });

  it("404s when sms is disabled", async () => {
    const app = buildApp(fakePrisma({ ...SMS_ROW, smsEnabled: false }));
    const res = await app.inject({
      method: "POST",
      payload: inboundPayload,
      url: "/api/public/sms/inbound/tok-abc",
    });
    expect(res.statusCode).toBe(404);
  });

  it("dispatches sms:received payloads to the inbound handler (Pro)", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: inboundPayload,
      url: "/api/public/sms/inbound/tok-abc",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.handleInboundSms).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "+351912345678",
      "estado?"
    );
  });

  it("free mode: sms:received returns 200 without processing anything", async () => {
    // Grátis = só envio — sem entitlement "sms" um texto normal é no-op
    // total: não toca em consentimento, não grava mensagens e não responde.
    const prisma = fakePrisma({ ...SMS_ROW, cloudEntitlements: [] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      payload: inboundPayload,
      url: "/api/public/sms/inbound/tok-abc",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.handleInboundSms).not.toHaveBeenCalled();
    expect(prisma.shopSettings.upsert).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("free mode: PARAR/STOP revoga consentimento sem gravar nem responder", async () => {
    // Opt-out é legal e não pode depender de pagamento — mesmo sem
    // entitlement a revogação corre (regra do bot Evolution). Só a
    // revogação: o resto do inbound grátis continua inerte.
    const prisma = fakePrisma({ ...SMS_ROW, cloudEntitlements: [] });
    const app = buildApp(prisma);
    for (const text of ["PARAR", "STOP", "parar"]) {
      const res = await app.inject({
        method: "POST",
        payload: {
          ...inboundPayload,
          payload: { ...inboundPayload.payload, message: text },
        },
        url: "/api/public/sms/inbound/tok-abc",
      });
      expect(res.statusCode).toBe(200);
    }
    expect(mocks.handleInboundSms).not.toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalledTimes(3);
    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: "c1" },
    });
  });

  it("free mode: texto com «parar» embutido não revoga (exact-match)", async () => {
    const prisma = fakePrisma({ ...SMS_ROW, cloudEntitlements: [] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      payload: {
        ...inboundPayload,
        payload: {
          ...inboundPayload.payload,
          message: "quero parar a reparação",
        },
      },
      url: "/api/public/sms/inbound/tok-abc",
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("ignores non-received events", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: { ...inboundPayload, event: "sms:sent" },
      url: "/api/public/sms/inbound/tok-abc",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.handleInboundSms).not.toHaveBeenCalled();
  });
});
