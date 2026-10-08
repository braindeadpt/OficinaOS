import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "../config/env.js";
import { setupRoutes } from "../routes/setup.js";
import {
  deriveIdentity,
  isLoopbackRequest,
  setupTokenMatches,
} from "../services/setup.service.js";

const SETUP_TOKEN = "tok_0123456789abcdef0123456789";

const mocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  txUserCount: vi.fn(),
  txUserCreate: vi.fn(),
  txAccountCreate: vi.fn(),
  txShopUpsert: vi.fn(),
  txAuditCreate: vi.fn(),
  txExecuteRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("scrypt-hash"),
}));

const VALID_BODY = {
  shopName: "TecFix Benfica",
  name: "Pedro Póvoas",
  login: "pedro",
  password: "Segura123",
  confirmPassword: "Segura123",
};

function buildApp() {
  const app = Fastify();
  app.decorateRequest("locale", "pt");
  (app.decorate as (name: string, value: unknown) => void)("prisma", {
    user: { count: mocks.userCount },
    $transaction: mocks.$transaction,
  });
  // Mirrors the global error handler in plugins/security.ts.
  app.setErrorHandler((error, _req, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({ code: error.code });
      return;
    }
    reply.status(500).send({ code: "INTERNAL_ERROR" });
  });
  app.register(setupRoutes);
  return app;
}

function post(
  app: ReturnType<typeof buildApp>,
  payload: Record<string, unknown>,
  opts: { remoteAddress?: string; headers?: Record<string, string> } = {}
) {
  return app.inject({
    method: "POST",
    url: "/api/setup",
    payload,
    remoteAddress: opts.remoteAddress ?? "127.0.0.1",
    headers: opts.headers,
  });
}

describe("first-run setup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SETUP_TOKEN = SETUP_TOKEN;
    resetEnvForTests();

    mocks.userCount.mockResolvedValue(0);
    mocks.txUserCount.mockResolvedValue(0);
    mocks.txExecuteRaw.mockResolvedValue(1);
    mocks.txUserCreate.mockResolvedValue({
      id: "user-1",
      username: "pedro",
      email: "pedro@oficinaos.local",
    });
    mocks.txAccountCreate.mockResolvedValue({ id: "acc-1" });
    mocks.txShopUpsert.mockResolvedValue({ id: "default" });
    mocks.txAuditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.$transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $executeRaw: mocks.txExecuteRaw,
          user: { count: mocks.txUserCount, create: mocks.txUserCreate },
          account: { create: mocks.txAccountCreate },
          shopSettings: { upsert: mocks.txShopUpsert },
          auditLog: { create: mocks.txAuditCreate },
        })
    );
  });

  afterAll(() => {
    process.env.SETUP_TOKEN = undefined;
    Reflect.deleteProperty(process.env, "SETUP_TOKEN");
    resetEnvForTests();
  });

  describe("POST /api/setup with 0 users", () => {
    it("creates the OWNER (no forced password change), the credential account and the shop name", async () => {
      const res = await post(buildApp(), VALID_BODY);

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        username: "pedro",
        email: "pedro@oficinaos.local",
      });
      // Lock taken and count re-checked inside the same transaction.
      expect(mocks.txExecuteRaw).toHaveBeenCalledTimes(1);
      expect(mocks.txUserCount).toHaveBeenCalledTimes(1);
      expect(mocks.txUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Pedro Póvoas",
            username: "pedro",
            email: "pedro@oficinaos.local",
            role: "OWNER",
            mustChangePassword: false,
            isActive: true,
          }),
        })
      );
      expect(mocks.txAccountCreate).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          accountId: "user-1",
          providerId: "credential",
          password: "scrypt-hash",
        },
      });
      expect(mocks.txShopUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "default" },
          create: { id: "default", shopName: "TecFix Benfica" },
          update: { shopName: "TecFix Benfica" },
        })
      );
    });

    it("accepts an email as the login and derives the username from it", async () => {
      const res = await post(buildApp(), {
        ...VALID_BODY,
        login: "Loja.Centro@Example.pt",
      });
      expect(res.statusCode).toBe(201);
      expect(mocks.txUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "loja.centro@example.pt",
            username: "loja_centro",
          }),
        })
      );
    });

    it("rejects mismatched passwords and weak passwords with 400", async () => {
      const app = buildApp();
      const mismatch = await post(app, {
        ...VALID_BODY,
        confirmPassword: "Outra1234",
      });
      expect(mismatch.statusCode).toBe(400);
      const weak = await post(app, {
        ...VALID_BODY,
        password: "curta",
        confirmPassword: "curta",
      });
      expect(weak.statusCode).toBe(400);
      expect(mocks.txUserCreate).not.toHaveBeenCalled();
    });

    it("returns 409 when another request created the owner first (count re-checked under the lock)", async () => {
      mocks.txUserCount.mockResolvedValue(1);
      const res = await post(buildApp(), VALID_BODY);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ code: "SETUP_ALREADY_DONE" });
      expect(mocks.txUserCreate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/setup with ≥1 user", () => {
    it("returns 404 and never opens a transaction", async () => {
      mocks.userCount.mockResolvedValue(1);
      const res = await post(buildApp(), VALID_BODY);
      expect(res.statusCode).toBe(404);
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });

    it("still returns 404 with a valid token", async () => {
      mocks.userCount.mockResolvedValue(3);
      const res = await post(
        buildApp(),
        { ...VALID_BODY, token: SETUP_TOKEN },
        { remoteAddress: "192.168.1.50" }
      );
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/setup from another device", () => {
    it("rejects a LAN address without a token (403 SETUP_NOT_LOCAL)", async () => {
      const res = await post(buildApp(), VALID_BODY, {
        remoteAddress: "192.168.1.50",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "SETUP_NOT_LOCAL" });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a LAN address with a wrong token", async () => {
      const res = await post(
        buildApp(),
        { ...VALID_BODY, token: "tok_wrong_wrong_wrong_wrong_xx" },
        { remoteAddress: "192.168.1.50" }
      );
      expect(res.statusCode).toBe(403);
    });

    it("rejects loopback traffic relayed by a local proxy/tunnel", async () => {
      const res = await post(buildApp(), VALID_BODY, {
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("accepts a LAN address with the one-time setup token", async () => {
      const res = await post(
        buildApp(),
        { ...VALID_BODY, token: SETUP_TOKEN },
        { remoteAddress: "172.17.0.1" }
      );
      expect(res.statusCode).toBe(201);
    });

    it("rejects any token when SETUP_TOKEN is not configured", async () => {
      Reflect.deleteProperty(process.env, "SETUP_TOKEN");
      resetEnvForTests();
      const res = await post(
        buildApp(),
        { ...VALID_BODY, token: "" },
        { remoteAddress: "192.168.1.50" }
      );
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /api/setup/status", () => {
    it("reports needsSetup + allowed for loopback with 0 users", async () => {
      const res = await buildApp().inject({
        method: "GET",
        url: "/api/setup/status",
      });
      expect(res.json()).toEqual({ needsSetup: true, allowed: true });
    });

    it("reports allowed=false from another device without a token", async () => {
      const res = await buildApp().inject({
        method: "GET",
        url: "/api/setup/status",
        remoteAddress: "192.168.1.50",
      });
      expect(res.json()).toEqual({ needsSetup: true, allowed: false });
    });

    it("reports allowed=true from another device with the token", async () => {
      const res = await buildApp().inject({
        method: "GET",
        url: `/api/setup/status?token=${SETUP_TOKEN}`,
        remoteAddress: "192.168.1.50",
      });
      expect(res.json()).toEqual({ needsSetup: true, allowed: true });
    });

    it("reports needsSetup=false once a user exists", async () => {
      mocks.userCount.mockResolvedValue(1);
      const res = await buildApp().inject({
        method: "GET",
        url: "/api/setup/status",
      });
      expect(res.json()).toEqual({ needsSetup: false, allowed: false });
    });
  });
});

describe("setup.service helpers", () => {
  it("treats only loopback without forwarding headers as local", () => {
    expect(isLoopbackRequest({ ip: "127.0.0.1", headers: {} })).toBe(true);
    expect(isLoopbackRequest({ ip: "::1", headers: {} })).toBe(true);
    expect(isLoopbackRequest({ ip: "::ffff:127.0.0.1", headers: {} })).toBe(
      true
    );
    expect(isLoopbackRequest({ ip: "192.168.1.10", headers: {} })).toBe(false);
    expect(
      isLoopbackRequest({ ip: "127.0.0.1", headers: { forwarded: "for=x" } })
    ).toBe(false);
  });

  it("compares tokens exactly and never matches an unset token", () => {
    expect(setupTokenMatches(SETUP_TOKEN, SETUP_TOKEN)).toBe(true);
    expect(setupTokenMatches(`${SETUP_TOKEN}x`, SETUP_TOKEN)).toBe(false);
    expect(setupTokenMatches(undefined, SETUP_TOKEN)).toBe(false);
    expect(setupTokenMatches("", undefined)).toBe(false);
  });

  it("derives username/email from either form of login", () => {
    expect(deriveIdentity("Pedro_1")).toEqual({
      username: "pedro_1",
      displayUsername: "Pedro_1",
      email: "pedro_1@oficinaos.local",
    });
    expect(deriveIdentity("ab@x.pt").username).toBe("ab_");
  });
});
