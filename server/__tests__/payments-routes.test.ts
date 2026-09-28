import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paymentRoutes } from "../routes/payments.js";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userHasPermission: vi.fn(),
  addPayment: vi.fn(),
  listForJob: vi.fn(),
  removePayment: vi.fn(),
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn().mockReturnValue(new Headers()),
}));

vi.mock("../services/payment.service.js", () => ({
  add: mocks.addPayment,
  listForJob: mocks.listForJob,
  remove: mocks.removePayment,
}));

vi.mock("../middlewares/rbac.js", () => ({
  // biome-ignore lint/suspicious/useAwait: middleware signature must be async
  requirePermission: () => async (request: any) => {
    if (!request.user) {
      throw new AppError("UNAUTHORIZED");
    }
  },
}));

function buildApp(userId: string | null) {
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

  const mockSession = userId
    ? {
        user: {
          id: userId,
          name: "Test",
          username: "test",
          email: "test@test.com",
          role: "OWNER",
          isActive: true,
          mustChangePassword: false,
        },
        session: { id: "sess-1" },
      }
    : null;

  mocks.getSession.mockResolvedValue(mockSession);
  mocks.userHasPermission.mockResolvedValue({ success: true });

  (app.decorate as (name: string, value: unknown) => void)("auth", {
    api: {
      getSession: mocks.getSession,
      userHasPermission: mocks.userHasPermission,
    },
  });

  (app.decorate as (name: string, value: unknown) => void)("prisma", {});

  app.addHook("preHandler", async (request: any, _reply: any) => {
    const session = await app.auth.api.getSession({ headers: new Headers() });
    if (!session) {
      request.user = null;
      return;
    }
    request.user = session.user;
  });

  app.register(paymentRoutes, { prefix: "/api/payments" });
  return app;
}

describe("GET /api/payments/:id/payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns payments and paidTotal", async () => {
    mocks.listForJob.mockResolvedValue({
      paidTotal: 1500,
      payments: [{ id: "pay-1", amount: 1500, method: "CASH" }],
    });

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/payments/job-1/payments",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.paidTotal).toBe(1500);
    expect(body.payments).toHaveLength(1);
  });

  it("returns 404 for unknown job", async () => {
    mocks.listForJob.mockResolvedValue(null);

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/payments/nope/payments",
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("JOB_NOT_FOUND");
  });
});

describe("POST /api/payments/:id/payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 and forwards validated payload", async () => {
    mocks.addPayment.mockResolvedValue({
      id: "pay-1",
      jobId: "job-1",
      method: "CARD",
      amount: 2000,
    });

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/job-1/payments",
      payload: { method: "CARD", amount: 2000, reference: "tx-99" },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).method).toBe("CARD");
    expect(mocks.addPayment).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "job-1",
      { method: "CARD", amount: 2000, reference: "tx-99" },
      "user-1"
    );
  });

  it("returns 400 for zero or negative amount", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/job-1/payments",
      payload: { method: "CASH", amount: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("VALIDATION_ERROR");
    expect(mocks.addPayment).not.toHaveBeenCalled();
  });

  it("returns 400 for unknown method", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/job-1/payments",
      payload: { method: "CRYPTO", amount: 10 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when payment exceeds balance", async () => {
    mocks.addPayment.mockResolvedValue({
      error: "PAYMENT_EXCEEDS_BALANCE",
      balanceDue: 3500,
    });

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/job-1/payments",
      payload: { method: "CASH", amount: 4000 },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("PAYMENT_EXCEEDS_BALANCE");
    expect(body.details.balanceDue).toBe(3500);
  });

  it("returns 404 when job does not exist", async () => {
    mocks.addPayment.mockResolvedValue(null);

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/nope/payments",
      payload: { method: "CASH", amount: 10 },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("JOB_NOT_FOUND");
  });

  it("returns 401 when not authenticated", async () => {
    const app = buildApp(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/payments/job-1/payments",
      payload: { method: "CASH", amount: 10 },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /api/payments/:id/payments/:paymentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 204 on success", async () => {
    mocks.removePayment.mockResolvedValue(true);

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/payments/job-1/payments/pay-1",
    });

    expect(res.statusCode).toBe(204);
    expect(mocks.removePayment).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "job-1",
      "pay-1",
      "user-1"
    );
  });

  it("maps service errors to error responses", async () => {
    mocks.removePayment.mockResolvedValue({ error: "PAYMENT_NOT_FOUND" });

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/payments/job-1/payments/nope",
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("PAYMENT_NOT_FOUND");
  });
});
