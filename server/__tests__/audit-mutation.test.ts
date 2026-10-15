import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  logAuditRequest,
  matchesRoutePrefix,
  shouldAuditRequest,
} from "../plugins/security.js";

function buildApp() {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply
        .status(error.status)
        .send({ code: error.code, message: error.message });
      return;
    }
    reply.status(500).send({ code: "INTERNAL_ERROR" });
  });

  const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
  (app.decorate as (name: string, value: unknown) => void)("prisma", {
    auditLog: { create: auditCreate },
  });

  // Fake auth: x-test-user header becomes request.user (like the auth plugin).
  app.addHook("preHandler", (request: any, _reply, done) => {
    const userId = request.headers["x-test-user"];
    request.user = userId ? { id: userId } : null;
    done();
  });

  // The real audit writer, wired exactly like the security plugin does.
  app.addHook("onResponse", (request, reply, done) => {
    done();
    logAuditRequest(request, reply);
  });

  // Production-shaped routes (minimal handlers — only the hook is under test).
  app.delete("/api/customers/:id", () => ({ ok: true }));
  app.post("/api/data-io/import/parts", () => ({ ok: true }));
  app.get("/api/export/jobs.csv", () => "id;name\n");
  app.patch("/api/parts/:id", () => ({ ok: true }));
  app.patch("/api/notifications/in-app/:id/read", () => ({ ok: true }));
  app.patch("/api/repairs/:id", () => {
    throw new AppError("FORBIDDEN");
  });
  app.post("/api/sales", (_req, reply) =>
    reply.status(400).send({ code: "VALIDATION_ERROR" })
  );

  return { app, auditCreate };
}

async function flushAudit() {
  // logAuditRequest defers the prisma write with setImmediate off the hot path.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function authed(headers: Record<string, string> = {}) {
  return { "x-test-user": "user-1", ...headers };
}

describe("audit log denylist (logAuditRequest)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits customer DELETE (RGPD erasure)", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/customers/cust-1",
      headers: authed(),
    });

    expect(res.statusCode).toBe(200);
    await flushAudit();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "API_MUTATION",
        toValue: "DELETE /api/customers/:id",
        metadata: expect.objectContaining({ statusCode: 200 }),
      }),
    });
  });

  it("audits data-io import mutations", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/data-io/import/parts",
      headers: authed(),
      payload: { rows: [] },
    });

    expect(res.statusCode).toBe(200);
    await flushAudit();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "API_MUTATION",
        toValue: "POST /api/data-io/import/parts",
      }),
    });
  });

  it("audits bulk CSV exports even though they are GETs", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/export/jobs.csv",
      headers: authed(),
    });

    expect(res.statusCode).toBe(200);
    await flushAudit();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "API_MUTATION",
        toValue: "GET /api/export/jobs.csv",
      }),
    });
  });

  it("audits parts PATCH (stock and price changes)", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/parts/part-1",
      headers: authed(),
      payload: { defaultPrice: 99 },
    });

    expect(res.statusCode).toBe(200);
    await flushAudit();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "API_MUTATION",
        toValue: "PATCH /api/parts/:id",
      }),
    });
  });

  it("does not audit notification mutations (noisy mark-as-read)", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/notifications/in-app/n1/read",
      headers: authed(),
    });

    expect(res.statusCode).toBe(200);
    await flushAudit();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("logs a 403 RBAC probe with its statusCode", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/repairs/rep-1",
      headers: authed(),
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    await flushAudit();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "API_MUTATION",
        toValue: "PATCH /api/repairs/:id",
        metadata: expect.objectContaining({ statusCode: 403 }),
      }),
    });
  });

  it("skips validation failures (400) and unknown routes (404)", async () => {
    const { app, auditCreate } = buildApp();

    const bad = await app.inject({
      method: "POST",
      url: "/api/sales",
      headers: authed(),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/nope",
      headers: authed(),
      payload: {},
    });
    expect(missing.statusCode).toBe(404);

    await flushAudit();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("skips unauthenticated mutations (nobody to attribute)", async () => {
    const { app, auditCreate } = buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/parts/part-1",
      payload: { defaultPrice: 99 },
    });

    expect(res.statusCode).toBe(200);
    await flushAudit();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe("shouldAuditRequest", () => {
  const authed200 = {
    userId: "user-1",
    statusCode: 200,
  };

  it("matches prefixes by segment, not by string prefix", () => {
    expect(matchesRoutePrefix("/api/users/123", "/api/users")).toBe(true);
    expect(matchesRoutePrefix("/api/users", "/api/users")).toBe(true);
    // Sibling routes must not match.
    expect(matchesRoutePrefix("/api/users-x", "/api/users")).toBe(false);
    expect(matchesRoutePrefix("/api/users-x/1", "/api/users")).toBe(false);
  });

  it("does not treat noisy siblings as noisy", () => {
    // e.g. /api/ai-tools is audited even though /api/ai is denylisted.
    expect(
      shouldAuditRequest({
        ...authed200,
        method: "DELETE",
        routeUrl: "/api/ai-tools/abc",
      })
    ).toBe(true);
    expect(
      shouldAuditRequest({
        ...authed200,
        method: "DELETE",
        routeUrl: "/api/ai/conversations/abc",
      })
    ).toBe(false);
  });

  it("skips 400/404/409/422 but keeps 401/403", () => {
    const base = {
      userId: "user-1",
      method: "PATCH",
      routeUrl: "/api/parts/part-1",
    };
    for (const statusCode of [400, 404, 409, 422]) {
      expect(shouldAuditRequest({ ...base, statusCode })).toBe(false);
    }
    for (const statusCode of [200, 201, 401, 403, 500]) {
      expect(shouldAuditRequest({ ...base, statusCode })).toBe(true);
    }
  });

  it("never audits GETs except bulk exports", () => {
    expect(
      shouldAuditRequest({
        ...authed200,
        method: "GET",
        routeUrl: "/api/dashboard",
      })
    ).toBe(false);
    expect(
      shouldAuditRequest({
        ...authed200,
        method: "GET",
        routeUrl: "/api/export/parts.csv",
      })
    ).toBe(true);
  });
});
