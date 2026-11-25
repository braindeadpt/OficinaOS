import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiRoutes } from "../routes/ai.js";

/**
 * WP0.5 — o chat de IA de staff (POST /api/ai/chat/stream) é Pro: exige
 * o módulo "ai-inbox" com cache de entitlements fresco (<24h), mesmo
 * quando a loja usa chave API própria. As outras rotas do ficheiro
 * (conversas, definições, memórias) NÃO são gated — só o uso do chat.
 */

const mocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(async () => ({ enabled: true, hasApiKey: true })),
  getOrCreateShopSettings: vi.fn(),
  getRawAiSettings: vi.fn(async () => ({ enabled: true })),
  streamChat: vi.fn(),
}));

vi.mock("../ai/stream.js", () => ({
  streamChat: mocks.streamChat,
}));

vi.mock("../services/settings.service.js", () => ({
  getAiSettings: mocks.getAiSettings,
  getRawAiSettings: mocks.getRawAiSettings,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

function shopWith(entitlements: string[], syncedAt: Date = new Date()) {
  return {
    cloudEntitlements: entitlements,
    cloudSyncedAt: syncedAt,
  };
}

function sseStream() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content","delta":"olá"}\n\n')
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function buildApp(
  user: { id: string; role: string } | null = {
    id: "u1",
    role: "OWNER",
  }
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
  app.decorate("prisma", {} as never);
  app.decorate("wsBroadcast", vi.fn() as never);
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(aiRoutes, { prefix: "/api/ai" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.streamChat.mockImplementation(async () => ({
    conversationId: "conv-1",
    stream: sseStream(),
  }));
});

describe("POST /api/ai/chat/stream — gate Pro ai-inbox (WP0.5)", () => {
  it("sem entitlement → 402 CLOUD_MODULE_REQUIRED e o stream nem arranca", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(shopWith([]));
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      payload: { message: "olá" },
      url: "/api/ai/chat/stream",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it("entitlement com cache velha (>24h) → 402", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(
      shopWith(["ai-inbox"], new Date(Date.now() - 25 * 3600 * 1000))
    );
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      payload: { message: "olá" },
      url: "/api/ai/chat/stream",
    });
    expect(res.statusCode).toBe(402);
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it("com ai-inbox fresco → fluxo normal de stream", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(shopWith(["ai-inbox"]));
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      payload: { message: "olá" },
      url: "/api/ai/chat/stream",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-conversation-id"]).toBe("conv-1");
    expect(res.body).toContain("olá");
    expect(mocks.streamChat).toHaveBeenCalledTimes(1);
  });

  it("IA desligada continua a dar AI_DISABLED antes do gate do módulo", async () => {
    mocks.getAiSettings.mockResolvedValueOnce({ enabled: false } as never);
    mocks.getOrCreateShopSettings.mockResolvedValue(shopWith(["ai-inbox"]));
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      payload: { message: "olá" },
      url: "/api/ai/chat/stream",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("AI_DISABLED");
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it("outras rotas do ficheiro não são gated — GET /api/ai/status passa sem entitlement", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(shopWith([]));
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/ai/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, hasApiKey: true });
  });
});
