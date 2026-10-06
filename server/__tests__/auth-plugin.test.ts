import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  authHandler: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  incrementFailedAttempt: vi.fn(),
  isAccountLocked: vi.fn().mockReturnValue(false),
  resetFailedAttempts: vi.fn(),
  auditCreate: vi.fn(),
}));

const fakeAuth = {
  handler: mocks.authHandler,
  api: { getSession: vi.fn().mockResolvedValue(null) },
};

vi.mock("../lib/auth.js", () => ({
  createAuth: () => fakeAuth,
  getSessionFromRequest: mocks.getSessionFromRequest,
}));

vi.mock("../services/account-lockout.service.js", () => ({
  incrementFailedAttempt: mocks.incrementFailedAttempt,
  isAccountLocked: mocks.isAccountLocked,
  resetFailedAttempts: mocks.resetFailedAttempts,
}));

const repoMocks = vi.hoisted(() => ({
  deleteOtherSessions: vi.fn(),
  findCredentialAccount: vi.fn(),
  findUserByUsername: vi.fn(),
  updateCredentialPassword: vi.fn(),
  updateMustChangePassword: vi.fn(),
  updateUsername: vi.fn(),
}));

vi.mock("../repositories/auth.repository.js", () => repoMocks);

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

const { default: authPlugin } = await import("../plugins/auth.js");
const { originAllowed } = await import("../plugins/websocket.js");
const { changePassword } = await import("../services/auth.service.js");

const baseSession = {
  id: "u1",
  name: "Admin",
  username: "admin",
  email: "admin@shop.local",
  role: "OWNER",
  isActive: true,
  mustChangePassword: false,
  sessionId: "sess-1",
};

function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply
        .status(error.status)
        .send({ code: error.code, message: error.message });
      return;
    }
    reply.status(500).send({ code: "INTERNAL_ERROR" });
  });
  app.decorate("prisma", {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
    },
    auditLog: { create: mocks.auditCreate },
  } as never);
  return app.register(authPlugin).then(() => {
    app.get("/api/secure", () => ({ ok: true }));
    return app;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAccountLocked.mockReturnValue(false);
  mocks.getSessionFromRequest.mockResolvedValue(baseSession);
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.userFindFirst.mockResolvedValue(null);
});

describe("auth preHandler", () => {
  it("passes a normal session through to the route", async () => {
    const app = await buildApp();
    const res = await app.inject({ url: "/api/secure" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getSessionFromRequest.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ url: "/api/secure" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("rejects a session flagged mustChangePassword", async () => {
    mocks.getSessionFromRequest.mockResolvedValue({
      ...baseSession,
      mustChangePassword: true,
    });
    const app = await buildApp();
    const res = await app.inject({ url: "/api/secure" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("still allows /api/auth/* while password change is pending", async () => {
    mocks.getSessionFromRequest.mockResolvedValue({
      ...baseSession,
      mustChangePassword: true,
    });
    mocks.authHandler.mockResolvedValue(
      new Response(JSON.stringify({ mustChangePassword: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const app = await buildApp();
    const res = await app.inject({ url: "/api/auth/must-change-password" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a disabled account", async () => {
    mocks.getSessionFromRequest.mockResolvedValue({
      ...baseSession,
      isActive: false,
    });
    const app = await buildApp();
    const res = await app.inject({ url: "/api/secure" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("ACCOUNT_DISABLED");
  });

  it("rejects a locked account with 423, not a wrapped 500", async () => {
    mocks.isAccountLocked.mockReturnValue(true);
    mocks.userFindUnique.mockResolvedValue({
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const app = await buildApp();
    const res = await app.inject({ url: "/api/secure" });
    expect(res.statusCode).toBe(423);
    expect(res.json().code).toBe("ACCOUNT_LOCKED");
  });
});

describe("sign-in lockout", () => {
  function okAuthResponse() {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("normalizes the identifier before lockout tracking", async () => {
    mocks.authHandler.mockResolvedValue(
      new Response("unauthorized", { status: 401 })
    );
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      payload: { username: "Admin ", password: "wrong" },
    });
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ username: "admin" }, { email: "admin" }] },
      })
    );
  });

  it("returns ACCOUNT_LOCKED instead of a wrapped 500 when the account is locked", async () => {
    mocks.isAccountLocked.mockReturnValue(true);
    mocks.userFindFirst.mockResolvedValue({
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    mocks.authHandler.mockResolvedValue(okAuthResponse());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/username",
      payload: { username: "admin", password: "x" },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().code).toBe("ACCOUNT_LOCKED");
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });
});

describe("changePassword session revocation", () => {
  function fakeTx() {
    return {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTxValue),
    } as never;
  }
  const fakeTxValue = { tx: true };

  beforeEach(() => {
    repoMocks.findCredentialAccount.mockResolvedValue({ password: "hash" });
  });

  it("revokes every session except the caller's", async () => {
    await changePassword(
      fakeTx(),
      "u1",
      "old-pass",
      "new-pass-123",
      undefined,
      "sess-keep"
    );
    expect(repoMocks.deleteOtherSessions).toHaveBeenCalledWith(
      fakeTxValue,
      "u1",
      "sess-keep"
    );
  });

  it("skips revocation when no session id is provided", async () => {
    await changePassword(fakeTx(), "u1", "old-pass", "new-pass-123");
    expect(repoMocks.deleteOtherSessions).not.toHaveBeenCalled();
  });
});

describe("WS origin guard", () => {
  it("allows same-origin, configured and absent origins", () => {
    // trustedOrigins derives from .env: APP_URL/API_URL/EXTRA_TRUSTED_ORIGINS.
    // Whatever the env resolves to, an absent Origin (non-browser client)
    // is allowed and a blatantly foreign origin is rejected.
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("https://evil.example.com")).toBe(false);
  });

  it("rejects origins outside the trusted set even with matching suffixes", () => {
    expect(originAllowed("https://oficinaos.app.evil.com")).toBe(false);
    expect(originAllowed("null")).toBe(false);
  });
});
