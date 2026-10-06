import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customersRoutes } from "../routes/customers.js";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userHasPermission: vi.fn(),
  createCustomer: vi.fn(),
  listCustomers: vi.fn(),
  searchCustomers: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn().mockReturnValue(new Headers()),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/customers.service.js", () => ({
  create: mocks.createCustomer,
  list: mocks.listCustomers,
  search: mocks.searchCustomers,
  update: mocks.updateCustomer,
}));

vi.mock("../middlewares/rbac.js", () => ({
  requirePermission:
    (permissions: Record<string, string[]>) => async (request: any) => {
      if (!request.user) {
        throw new AppError("UNAUTHORIZED");
      }
      const result = await request.server.auth.api.userHasPermission({
        body: {
          role: request.user.role,
          permissions,
        },
      });
      if (!result.success) {
        throw new AppError("FORBIDDEN");
      }
    },
}));

function buildApp(userId: string | null, role = "OWNER") {
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
          role,
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

  (app.decorate as (name: string, value: unknown) => void)("prisma", {
    customer: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  });

  app.addHook("preHandler", async (request: any) => {
    const session = await app.auth.api.getSession({
      headers: new Headers(),
    });
    if (!session) {
      request.user = null;
      return;
    }
    request.user = session.user;
  });

  app.register(customersRoutes, { prefix: "/api/customers" });
  return app;
}

describe("PATCH /api/customers/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and updates customer with customers.edit permission", async () => {
    const updated = {
      id: "cust-1",
      name: "Updated Name",
      phone: "0555123456",
      email: "new@test.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.updateCustomer.mockResolvedValue(updated);

    const app = buildApp("user-1", "OWNER");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/customers/cust-1",
      payload: { name: "Updated Name", email: "new@test.com" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Updated Name");
    expect(body.email).toBe("new@test.com");
    expect(mocks.updateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: expect.objectContaining({
          findMany: expect.any(Function),
          count: expect.any(Function),
        }),
      }),
      "cust-1",
      { name: "Updated Name", email: "new@test.com" }
    );
  });

  it("returns 403 when user lacks customers.edit permission", async () => {
    const app = buildApp("user-1", "TECHNICIAN");
    mocks.userHasPermission.mockImplementation(
      ({ body: { permissions } }: any) => {
        if (permissions.customers?.includes("edit")) {
          return { success: false };
        }
        return { success: true };
      }
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/api/customers/cust-1",
      payload: { name: "Updated Name" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const app = buildApp("user-1", "OWNER");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/customers/cust-1",
      payload: { name: "" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for nonexistent customer", async () => {
    mocks.updateCustomer.mockResolvedValue(null);

    const app = buildApp("user-1", "OWNER");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/customers/nonexistent",
      payload: { name: "Updated Name" },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp(null);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/customers/cust-1",
      payload: { name: "Updated Name" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("customer field limits and duplicate phones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a 5000-character customer name", async () => {
    const app = buildApp("user-1", "OWNER");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/customers/cust-1",
      payload: { name: "x".repeat(5000) },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.errors.name).toBeDefined();
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
  });
});
