import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { intakeTermsRoutes } from "../routes/intake-terms.js";

interface PermissionRequest {
  body: {
    permissions: Record<string, string[] | undefined>;
    role?: string;
  };
}

function build(role: string, row: Record<string, unknown> | null) {
  const permissionChecks: PermissionRequest[] = [];
  const prisma = {
    shopSettings: { findUnique: vi.fn(async () => row) },
  };
  const app = Fastify();
  app.decorate("prisma", prisma as never);
  app.decorate("auth", {
    api: {
      userHasPermission: (req: PermissionRequest) => {
        permissionChecks.push(req);
        // Simulate role grants: VIEWER has no jobs:create, the intake
        // roles do. The route's requested permissions stay observable.
        return Promise.resolve({
          success:
            req.body.role !== "VIEWER" &&
            req.body.permissions.jobs !== undefined,
        });
      },
    },
  } as never);
  app.addHook("onRequest", (req, _reply, done) => {
    req.user = { id: "u1", role } as never;
    done();
  });
  app.setErrorHandler((error, _req, reply) =>
    reply
      .status(isAppError(error) ? error.status : 500)
      .send({ code: isAppError(error) ? error.code : "INTERNAL_ERROR" })
  );
  app.register(intakeTermsRoutes, { prefix: "/api/settings" });
  return { app, permissionChecks };
}

const SHOP_ROW = {
  id: "default",
  intakeTerms: "Cláusulas personalizadas da loja",
  shopName: "Loja Secreta",
  cloudShopTokenEncrypted: "encrypted-secret",
};

describe("GET /settings/intake-terms", () => {
  it("serves custom clauses to FRONT_DESK without settings:view", async () => {
    const { app, permissionChecks } = build("FRONT_DESK", SHOP_ROW);
    const res = await app.inject({ url: "/api/settings/intake-terms" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ intakeTerms: SHOP_ROW.intakeTerms });
    // Scoped to jobs:create — the full settings payload stays owner-only.
    expect(permissionChecks[0]?.body.permissions).toEqual({
      jobs: ["create"],
    });
    await app.close();
  });

  it("serves custom clauses to TECHNICIAN", async () => {
    const { app } = build("TECHNICIAN", SHOP_ROW);
    const res = await app.inject({ url: "/api/settings/intake-terms" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ intakeTerms: SHOP_ROW.intakeTerms });
    await app.close();
  });

  it("rejects roles without jobs:create", async () => {
    const { app } = build("VIEWER", SHOP_ROW);
    const res = await app.inject({ url: "/api/settings/intake-terms" });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns null when the shop never configured terms", async () => {
    const { app } = build("OWNER", { ...SHOP_ROW, intakeTerms: null });
    const res = await app.inject({ url: "/api/settings/intake-terms" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ intakeTerms: null });
    await app.close();
  });
});
