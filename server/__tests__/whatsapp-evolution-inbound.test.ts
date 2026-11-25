import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicRoutes } from "../routes/public.js";

const mocks = vi.hoisted(() => ({
  handleEvolutionInbound: vi.fn(
    async (_prisma: unknown, _log: unknown, _ctx: unknown, _body: unknown) =>
      undefined
  ),
}));

vi.mock("../services/evolution-bot.service.js", () => ({
  handleEvolutionInbound: mocks.handleEvolutionInbound,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: vi.fn(
    async (prisma: {
      shopSettings: { findUnique: (args: unknown) => Promise<unknown> };
    }) => await prisma.shopSettings.findUnique({ where: { id: "default" } })
  ),
}));

const EVO_ROW = {
  evolutionWebhookToken: "evo-tok",
  whatsappEnabled: true,
  whatsappTransport: "evolution",
};

function fakePrisma(row: Record<string, unknown> = EVO_ROW) {
  return {
    shopSettings: {
      findUnique: vi.fn(async () => ({ ...row })),
    },
  };
}

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
  app.decorate("prisma", prisma as never);
  app.decorate("wsBroadcast", vi.fn() as never);
  app.register(publicRoutes, { prefix: "/api/public" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/public/whatsapp/evolution/inbound (token no header)", () => {
  const webhookBody = {
    event: "messages.upsert",
    data: { key: { remoteJid: "351900000001@s.whatsapp.net" } },
  };

  it("aceita o token no header x-oficinaos-webhook-token", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      headers: { "x-oficinaos-webhook-token": "evo-tok" },
      method: "POST",
      payload: webhookBody,
      url: "/api/public/whatsapp/evolution/inbound",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mocks.handleEvolutionInbound).toHaveBeenCalledTimes(1);
    expect(mocks.handleEvolutionInbound.mock.calls[0]?.[3]).toMatchObject(
      webhookBody
    );
  });

  it("404 sem header — o path não leva credencial", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: webhookBody,
      url: "/api/public/whatsapp/evolution/inbound",
    });
    expect(res.statusCode).toBe(404);
    expect(mocks.handleEvolutionInbound).not.toHaveBeenCalled();
  });

  it("404 com token errado no header", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      headers: { "x-oficinaos-webhook-token": "wrong" },
      method: "POST",
      payload: webhookBody,
      url: "/api/public/whatsapp/evolution/inbound",
    });
    expect(res.statusCode).toBe(404);
    expect(mocks.handleEvolutionInbound).not.toHaveBeenCalled();
  });

  it("404 quando o transporte não é evolution", async () => {
    const app = buildApp(fakePrisma({ ...EVO_ROW, whatsappTransport: "meta" }));
    const res = await app.inject({
      headers: { "x-oficinaos-webhook-token": "evo-tok" },
      method: "POST",
      payload: webhookBody,
      url: "/api/public/whatsapp/evolution/inbound",
    });
    expect(res.statusCode).toBe(404);
    expect(mocks.handleEvolutionInbound).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/whatsapp/evolution/inbound/:token (legado)", () => {
  it("continua a aceitar o token no path — webhooks já registados", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: { event: "messages.upsert" },
      url: "/api/public/whatsapp/evolution/inbound/evo-tok",
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.handleEvolutionInbound).toHaveBeenCalledTimes(1);
  });

  it("404 com token errado no path", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: { event: "messages.upsert" },
      url: "/api/public/whatsapp/evolution/inbound/wrong",
    });
    expect(res.statusCode).toBe(404);
    expect(mocks.handleEvolutionInbound).not.toHaveBeenCalled();
  });
});
