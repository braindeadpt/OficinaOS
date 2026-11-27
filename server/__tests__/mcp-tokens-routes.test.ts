import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpTokenRoutes } from "../routes/mcp-tokens.js";

/**
 * Isolamento de tokens MCP (decisão do mentor):
 * — qualquer utilizador cria/lista/revoga os SEUS tokens;
 * — um utilizador nunca vê nem revoga os tokens de outro;
 * — o dono (OWNER) vê todos e revoga qualquer um.
 */

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

interface Actor {
  id: string;
  role: string;
}

function buildApp(actor: Actor | null) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({ code: error.code });
      return;
    }
    reply.status(500).send({ error: String(error) });
  });
  app.decorate("prisma", {
    mcpToken: prismaMocks,
  } as unknown as import("@generated/client").PrismaClient);
  app.addHook("preHandler", (req, _reply, done) => {
    (req as { user: unknown }).user = actor
      ? {
          id: actor.id,
          role: actor.role,
          name: actor.id,
          username: actor.id,
          email: "",
          isActive: true,
          mustChangePassword: false,
          twoFactorEnabled: false,
          sessionId: "s",
        }
      : null;
    done();
  });
  app.register(mcpTokenRoutes, { prefix: "/api/mcp/tokens" });
  return app;
}

const TECHNICIAN: Actor = { id: "tec-1", role: "TECHNICIAN" };
const OWNER: Actor = { id: "owner-1", role: "OWNER" };

const baseToken = {
  id: "tok-1",
  userId: "tec-1",
  name: "Claude",
  prefix: "oos_abc",
  tokenHash: "hash",
  showPii: false,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tokens MCP — self-service", () => {
  it("GET lista só os tokens do próprio", async () => {
    prismaMocks.findMany.mockResolvedValue([baseToken]);
    const app = buildApp(TECHNICIAN);
    const res = await app.inject({ method: "GET", url: "/api/mcp/tokens" });
    expect(res.statusCode).toBe(200);
    expect(prismaMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "tec-1" } })
    );
  });

  it("DELETE do próprio token revoga", async () => {
    prismaMocks.findFirst.mockResolvedValue(baseToken);
    prismaMocks.update.mockResolvedValue(baseToken);
    const app = buildApp(TECHNICIAN);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/mcp/tokens/tok-1",
    });
    expect(res.statusCode).toBe(200);
    expect(prismaMocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok-1", userId: "tec-1" } })
    );
  });
});

describe("tokens MCP — isolamento entre utilizadores", () => {
  it("um técnico não revoga o token de outro (404, sem revogar)", async () => {
    // A query leva userId do caller — um token de outro nunca é encontrado.
    prismaMocks.findFirst.mockResolvedValue(null);
    const app = buildApp({ id: "tec-2", role: "TECHNICIAN" });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/mcp/tokens/tok-1",
    });
    expect(res.statusCode).toBe(404);
    expect(prismaMocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok-1", userId: "tec-2" } })
    );
    expect(prismaMocks.update).not.toHaveBeenCalled();
  });

  it("GET /all é proibido a não-OWNER", async () => {
    const app = buildApp(TECHNICIAN);
    const res = await app.inject({ method: "GET", url: "/api/mcp/tokens/all" });
    expect(res.statusCode).toBe(403);
    expect(prismaMocks.findMany).not.toHaveBeenCalled();
  });
});

describe("tokens MCP — supervisão do dono", () => {
  it("GET /all lista todos com o utilizador de cada token", async () => {
    prismaMocks.findMany.mockResolvedValue([
      { ...baseToken, user: { name: "Técnico Um", username: "tec1" } },
    ]);
    const app = buildApp(OWNER);
    const res = await app.inject({ method: "GET", url: "/api/mcp/tokens/all" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>[];
    expect(body[0]?.userName).toBe("Técnico Um");
    expect(prismaMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { user: { select: { name: true, username: true } } },
      })
    );
  });

  it("o dono revoga o token de outro utilizador", async () => {
    prismaMocks.findFirst.mockResolvedValue(baseToken);
    prismaMocks.update.mockResolvedValue(baseToken);
    const app = buildApp(OWNER);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/mcp/tokens/tok-1",
    });
    expect(res.statusCode).toBe(200);
    // Sem userId no filtro — o dono revoga qualquer token.
    expect(prismaMocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok-1" } })
    );
    expect(prismaMocks.update).toHaveBeenCalled();
  });

  it("sem autenticação nada passa", async () => {
    const app = buildApp(null);
    const res = await app.inject({ method: "GET", url: "/api/mcp/tokens" });
    expect(res.statusCode).toBe(401);
  });
});

describe("F6 — validade máxima de 1 ano", () => {
  function createAppWithCreate() {
    const created: unknown[] = [];
    prismaMocks.create = vi
      .fn()
      .mockImplementation(({ data }: { data: unknown }) => {
        created.push(data);
        return Promise.resolve({
          ...baseToken,
          ...(data as object),
          id: "new-1",
        });
      });
    return { created };
  }

  it("sem expiresAt o token nasce com validade de ~1 ano", async () => {
    const { created } = createAppWithCreate();
    const app = await buildApp(OWNER);
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp/tokens",
      payload: { name: "Claude" },
    });
    expect(res.statusCode).toBe(201);
    const data = created[0] as { expiresAt: Date };
    const yearMs = 365 * 24 * 3600 * 1000;
    const delta = data.expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(yearMs - 60_000);
    expect(delta).toBeLessThanOrEqual(yearMs);
  });

  it("expiresAt além de 1 ano é rejeitado", async () => {
    createAppWithCreate();
    const app = await buildApp(OWNER);
    const beyond = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp/tokens",
      payload: { name: "Claude", expiresAt: beyond },
    });
    expect(res.statusCode).not.toBe(201);
  });

  it("expiresAt dentro de 1 ano é aceite", async () => {
    const { created } = createAppWithCreate();
    const app = await buildApp(OWNER);
    const within = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp/tokens",
      payload: { name: "Claude", expiresAt: within },
    });
    expect(res.statusCode).toBe(201);
    expect((created[0] as { expiresAt: Date }).expiresAt.toISOString()).toBe(
      new Date(within).toISOString()
    );
  });
});
