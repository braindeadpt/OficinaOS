import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTzCache } from "../middlewares/dashboard-scope.js";
import { reportsRoutes } from "../routes/reports.js";

const mocks = vi.hoisted(() => ({
  cashReport: vi.fn(),
  closeCashSession: vi.fn(),
  getSessionWithReport: vi.fn(),
  reopenCashSession: vi.fn(),
}));

vi.mock("../services/cash-report.service.js", () => ({
  cashReport: mocks.cashReport,
}));

vi.mock("../services/cash-session.service.js", () => ({
  closeCashSession: mocks.closeCashSession,
  getSessionWithReport: mocks.getSessionWithReport,
  reopenCashSession: mocks.reopenCashSession,
}));

vi.mock("../services/parts-consumption.service.js", () => ({
  partsConsumptionReport: vi.fn(),
}));

vi.mock("../services/reports.service.js", () => ({
  insightsReport: vi.fn(),
  operationsReport: vi.fn(),
  resolveRange: vi.fn(),
  returnsReport: vi.fn(),
  revenueReport: vi.fn(),
}));

vi.mock("../middlewares/rbac.js", () => ({
  // biome-ignore lint/suspicious/useAwait: middleware signature must be async
  requirePermission: () => async (request: any) => {
    if (!request.user) {
      throw new AppError("UNAUTHORIZED");
    }
  },
}));

function buildApp(user: { id: string; role: string } | null) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const payload: Record<string, unknown> = {
        code: error.code,
        message: error instanceof Error ? error.message : "Internal error",
      };
      if (error.details !== undefined) {
        payload.details = error.details;
      }
      reply.status(error.status).send(payload);
      return;
    }
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });

  app.decorate("prisma", {
    shopSettings: { findFirst: vi.fn().mockResolvedValue({ timezone: "UTC" }) },
  } as never);
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    done();
  });
  app.register(reportsRoutes, { prefix: "/api/reports" });
  return app;
}

beforeEach(() => {
  __resetTzCache();
  vi.clearAllMocks();
});

const sessionDTO = {
  counted: { cash: null, nonCash: null, totalCollected: null },
  divergence: { cash: null },
  id: "cs-1",
  openedAt: "2026-09-29T10:00:00.000Z",
  openedBy: { id: "u1", name: "Owner" },
  reopenCount: 0,
  status: "OPEN",
};

describe("GET /api/reports/cash/session", () => {
  it("returns today's session (auto-opened)", async () => {
    mocks.getSessionWithReport.mockResolvedValue(sessionDTO);

    const res = await buildApp({ id: "u1", role: "OWNER" }).inject({
      method: "GET",
      url: "/api/reports/cash/session",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe("cs-1");
    expect(body.status).toBe("OPEN");
    expect(mocks.getSessionWithReport).toHaveBeenCalledWith(expect.anything(), {
      role: "OWNER",
      shopTz: "UTC",
      userId: "u1",
    });
  });

  it("401 without a session", async () => {
    const res = await buildApp(null).inject({
      method: "GET",
      url: "/api/reports/cash/session",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/reports/cash/close", () => {
  it("closes with counted cash and signature", async () => {
    mocks.closeCashSession.mockResolvedValue({
      ...sessionDTO,
      counted: { cash: 100.5, nonCash: null, totalCollected: null },
      divergence: { cash: -12.5 },
      status: "CLOSED",
    });

    const res = await buildApp({ id: "u1", role: "OWNER" }).inject({
      method: "POST",
      url: "/api/reports/cash/close",
      payload: {
        countedCash: 100.5,
        signatureDataUrl: "data:image/png;base64,AAA",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("CLOSED");
    expect(body.counted.cash).toBe(100.5);
    expect(mocks.closeCashSession).toHaveBeenCalledWith(
      expect.anything(),
      { role: "OWNER", shopTz: "UTC", userId: "u1" },
      expect.objectContaining({
        countedCash: 100.5,
        signatureDataUrl: "data:image/png;base64,AAA",
      })
    );
  });

  it("400 on invalid body", async () => {
    const res = await buildApp({ id: "u1", role: "OWNER" }).inject({
      method: "POST",
      url: "/api/reports/cash/close",
      payload: { countedCash: -5 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("VALIDATION_ERROR");
  });

  it("409 when the day is already closed", async () => {
    mocks.closeCashSession.mockRejectedValue(
      new AppError("CASH_SESSION_ALREADY_CLOSED")
    );

    const res = await buildApp({ id: "u1", role: "OWNER" }).inject({
      method: "POST",
      url: "/api/reports/cash/close",
      payload: { countedCash: 10 },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("CASH_SESSION_ALREADY_CLOSED");
  });
});

describe("POST /api/reports/cash/reopen", () => {
  it("reopens a closed day", async () => {
    mocks.reopenCashSession.mockResolvedValue({
      ...sessionDTO,
      reopenCount: 1,
    });

    const res = await buildApp({ id: "u1", role: "OWNER" }).inject({
      method: "POST",
      url: "/api/reports/cash/reopen",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reopenCount).toBe(1);
    expect(mocks.reopenCashSession).toHaveBeenCalledWith(expect.anything(), {
      role: "OWNER",
      shopTz: "UTC",
      userId: "u1",
    });
  });

  it("409 when the day is not closed", async () => {
    mocks.reopenCashSession.mockRejectedValue(
      new AppError("CASH_SESSION_NOT_CLOSED")
    );

    const res = await buildApp({ id: "u1", role: "OWNER" }).inject({
      method: "POST",
      url: "/api/reports/cash/reopen",
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("CASH_SESSION_NOT_CLOSED");
  });
});
