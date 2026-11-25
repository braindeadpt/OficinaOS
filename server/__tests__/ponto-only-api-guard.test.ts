import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPontoOnlyBlockedApiPath,
  registerPontoOnlyApiGuard,
} from "../services/shop-mode.js";

const findUnique = vi.fn();

function buildApp() {
  const app = Fastify();
  (app.decorate as (name: string, value: unknown) => void)("prisma", {
    shopSettings: { findUnique },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({ code: error.code });
      return;
    }
    reply.status(500).send({ code: "INTERNAL_ERROR" });
  });
  registerPontoOnlyApiGuard(app);
  app.get("/api/jobs", async () => ({ ok: true }));
  app.get("/api/parts/123", async () => ({ ok: true }));
  app.get("/api/reports/cash/session", async () => ({ ok: true }));
  app.get("/api/sales/abc", async () => ({ ok: true }));
  app.get("/api/ponto/status", async () => ({ ok: true }));
  return app;
}

describe("modo só ponto — guarda das APIs de oficina", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ shopMode: "ponto_only" });
  });

  it.each([
    ["/api/jobs", "reparações"],
    ["/api/parts/123", "stock"],
    ["/api/reports/cash/session", "caixa"],
    ["/api/sales/abc", "POS"],
  ])("%s (%s) devolve 404", async (path) => {
    const res = await buildApp().inject({ method: "GET", url: path });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "NOT_FOUND" });
  });

  it("não bloqueia o próprio ponto", async () => {
    const res = await buildApp().inject({
      method: "GET",
      url: "/api/ponto/status",
    });
    expect(res.statusCode).toBe(200);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("modo normal mantém as rotas de oficina disponíveis", async () => {
    findUnique.mockResolvedValue({ shopMode: "repair_shop" });
    const res = await buildApp().inject({ method: "GET", url: "/api/jobs" });
    expect(res.statusCode).toBe(200);
  });

  it("o classificador usa fronteira de segmento, não substring", () => {
    expect(isPontoOnlyBlockedApiPath("/api/jobs/abc")).toBe(true);
    expect(isPontoOnlyBlockedApiPath("/api/jobs-settings")).toBe(false);
    expect(isPontoOnlyBlockedApiPath("/api/settings")).toBe(false);
  });
});
