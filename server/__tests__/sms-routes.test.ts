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
  registerSmsWebhook: vi.fn(),
  sendSms: vi.fn(),
  upsertSmsSettings: vi.fn(),
}));

vi.mock("../services/sms.service.js", () => ({
  checkSmsGateway: mocks.checkSmsGateway,
  decryptSmsConfig: mocks.decryptSmsConfig,
  handleInboundSms: mocks.handleInboundSms,
  registerSmsWebhook: mocks.registerSmsWebhook,
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
  smsEnabled: true,
  smsGatewayPasswordEncrypted: "v1:enc",
  smsGatewayUrl: "http://192.168.1.50:8080",
  smsGatewayUser: "sms",
  smsWebhookToken: "tok-abc",
};

function fakePrisma(row: Record<string, unknown> = SMS_ROW) {
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
  it("enables without any cloud entitlement — SMS is core", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    mocks.decryptSmsConfig.mockReturnValue(null);
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
    expect(res.statusCode).toBe(200);
    expect(mocks.upsertSmsSettings).toHaveBeenCalled();
  });

  it("accepts disabling even without the entitlement", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: false });
    const app = buildApp(fakePrisma({ ...SMS_ROW, cloudEntitlements: [] }));
    const res = await app.inject({
      method: "PUT",
      payload: { enabled: false },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.upsertSmsSettings).toHaveBeenCalled();
  });

  it("registers the gateway webhook when saving config", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    mocks.decryptSmsConfig.mockReturnValue({
      password: "p",
      url: "http://192.168.1.50:8080",
      user: "sms",
    });
    mocks.registerSmsWebhook.mockResolvedValue({ success: true });
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
    expect(res.json().webhookRegistered).toBe(true);
    const hookArgs = mocks.registerSmsWebhook.mock.calls[0];
    expect(hookArgs?.[1]).toBe(
      "http://192.168.1.10:4000/api/public/sms/inbound/tok-abc"
    );
  });

  it("keeps saved settings when the gateway is unreachable", async () => {
    mocks.getSmsSettings.mockResolvedValue({ enabled: true });
    mocks.decryptSmsConfig.mockReturnValue(null);
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "PUT",
      payload: { enabled: true },
      url: "/api/settings/sms",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().webhookRegistered).toBe(false);
  });
});

describe("POST /api/settings/sms/test", () => {
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

  it("dispatches sms:received payloads to the inbound handler", async () => {
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
