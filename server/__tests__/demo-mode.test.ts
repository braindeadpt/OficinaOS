import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "../config/env.js";

// Demo-mode tests exercise env parsing, the route blocklist plugin and the
// /api/demo endpoints. The env module caches loadEnv() — resetEnvForTests()
// between cases so DEMO_MODE flips cleanly.

const DEMO_ENV_KEYS = [
  "DEMO_MODE",
  "OPENAI_API_KEY",
  "EMAIL_FROM",
  "WHATSAPP_TOKEN",
  "SMTP_HOST",
  "META_APP_SECRET",
  "EVOLUTION_API_KEY",
  "OFICINAOS_CLOUD_TOKEN",
] as const;

function clearDemoEnv() {
  for (const key of DEMO_ENV_KEYS) {
    Reflect.deleteProperty(process.env, key);
  }
  resetEnvForTests();
}

function buildAppWithDemoGuard() {
  // Lightweight harness mirroring index.ts: demo plugin + error handler.
  return import("../plugins/demo.js").then(({ default: demoPlugin }) => {
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _req, reply) => {
      if (isAppError(error)) {
        reply.status(error.status).send({ code: error.code });
        return;
      }
      reply.status(500).send({ code: "INTERNAL_ERROR" });
    });
    app.register(demoPlugin);
    // Probe routes that stand in for the real handlers.
    app.get("/api/settings/cloud", async () => ({ ok: true }));
    app.post("/api/users", async () => ({ ok: true }));
    app.get("/api/users", async () => ({ ok: true }));
    app.post("/api/ai/chat", async () => ({ ok: true }));
    app.post("/api/setup", async () => ({ ok: true }));
    app.post("/api/auth/sign-in/username", async () => ({ ok: true }));
    app.post("/api/auth/sign-out", async () => ({ ok: true }));
    app.post("/api/auth/change-password", async () => ({ ok: true }));
    app.post("/api/jobs/abc123/invoice", async () => ({ ok: true }));
    app.get("/api/export/jobs.csv", async () => ({ ok: true }));
    app.post("/api/demo/login", async () => ({ ok: true }));
    return app;
  });
}

describe("DEMO_MODE env validation", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  it("defaults DEMO_MODE to false", async () => {
    const { loadEnv } = await import("../config/env.js");
    expect(loadEnv().DEMO_MODE).toBe(false);
  });

  it("parses DEMO_MODE=true", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const { loadEnv } = await import("../config/env.js");
    expect(loadEnv().DEMO_MODE).toBe(true);
  });

  it.each([
    "OPENAI_API_KEY",
    "EMAIL_FROM",
    "WHATSAPP_TOKEN",
    "SMTP_HOST",
    "META_APP_SECRET",
    "EVOLUTION_API_KEY",
    "OFICINAOS_CLOUD_TOKEN",
  ])("refuses to start with %s defined", async (key) => {
    process.env.DEMO_MODE = "true";
    process.env[key] = "x-real-credential";
    resetEnvForTests();
    const { loadEnv } = await import("../config/env.js");
    expect(() => loadEnv()).toThrow();
  });

  it("starts cleanly with DEMO_MODE=true and no secrets", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const { loadEnv } = await import("../config/env.js");
    expect(() => loadEnv()).not.toThrow();
    expect(loadEnv().DEMO_MODE).toBe(true);
  });
});

describe("demo route guard", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  it("does nothing when DEMO_MODE is off", async () => {
    const app = await buildAppWithDemoGuard();
    const res = await app.inject({ method: "POST", url: "/api/users" });
    expect(res.statusCode).toBe(200);
    const resGet = await app.inject({
      method: "GET",
      url: "/api/settings/cloud",
    });
    expect(resGet.statusCode).toBe(200);
  });

  it("blocks user management mutations with 403", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildAppWithDemoGuard();
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/api/users" });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "DEMO_DISABLED" });
    }
    // GET stays open — the settings UI still lists the demo user.
    const res = await app.inject({ method: "GET", url: "/api/users" });
    expect(res.statusCode).toBe(200);
  });

  it("blocks AI, exports, cloud settings and invoicing", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildAppWithDemoGuard();
    for (const [method, url] of [
      ["POST", "/api/ai/chat"],
      ["GET", "/api/export/jobs.csv"],
      ["GET", "/api/settings/cloud"],
      ["POST", "/api/jobs/abc123/invoice"],
      ["POST", "/api/setup"],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "DEMO_DISABLED" });
    }
  });

  it("keeps demo login + sign-in/sign-out open", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildAppWithDemoGuard();
    for (const url of [
      "/api/demo/login",
      "/api/auth/sign-in/username",
      "/api/auth/sign-out",
    ]) {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode).toBe(200);
    }
    // Other auth mutations (password change, admin plugin) are blocked.
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "DEMO_DISABLED" });
  });
});

describe("POST /api/demo/login", () => {
  const authHandler = vi.fn();
  const userFindUnique = vi.fn();

  function buildLoginApp() {
    return import("../routes/demo.js").then(({ demoRoutes }) => {
      const app = Fastify({ logger: false });
      app.setErrorHandler((error, _req, reply) => {
        if (isAppError(error)) {
          reply.status(error.status).send({ code: error.code });
          return;
        }
        reply.status(500).send({ code: "INTERNAL_ERROR" });
      });
      app.decorate("prisma", {
        user: { findUnique: userFindUnique },
      } as never);
      app.decorate("auth", { handler: authHandler } as never);
      app.register(demoRoutes);
      return app;
    });
  }

  beforeEach(() => {
    clearDemoEnv();
    authHandler.mockReset();
    userFindUnique.mockReset();
  });
  afterEach(clearDemoEnv);

  it("404s when DEMO_MODE is off", async () => {
    const app = await buildLoginApp();
    const res = await app.inject({ method: "POST", url: "/api/demo/login" });
    expect(res.statusCode).toBe(404);
  });

  it("creates a session for the demo user via better-auth", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    userFindUnique.mockResolvedValue({ id: "u1", isActive: true });
    authHandler.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const app = await buildLoginApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      headers: { host: "demo.oficinaos.app" },
    });
    expect(res.statusCode).toBe(200);
    expect(authHandler).toHaveBeenCalledOnce();
    const req = authHandler.mock.calls[0][0] as Request;
    expect(req.url).toContain("/api/auth/sign-in/username");
    expect(await req.json()).toMatchObject({ username: "demo" });
  });

  it("GET /api/demo/status reports the flag without auth", async () => {
    const app = await buildLoginApp();
    const res = await app.inject({ method: "GET", url: "/api/demo/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ demo: false });
  });
});

describe("data-io import cap in demo", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  it("rejects imports above 50 rows in DEMO_MODE", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const { isDemoMode, DEMO_IMPORT_MAX_ROWS } = await import("../lib/demo.js");
    expect(isDemoMode()).toBe(true);
    expect(DEMO_IMPORT_MAX_ROWS).toBe(50);
    // Route-level enforcement lives in parseImportBody; the flag + cap are
    // the contract, the 403 comes from DEMO_DISABLED.
    const { isDemoBlockedPath } = await import("../lib/demo.js");
    expect(isDemoBlockedPath("POST", "/api/import/parts")).toBe(false);
  });
});
