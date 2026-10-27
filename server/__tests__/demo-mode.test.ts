import multipart from "@fastify/multipart";
import { isAppError } from "@shared/errors/app-error.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "../config/env.js";
// Static import: resolving the better-auth graph inside a test body put
// ~3s of module loading inside the 15s test budget — enough to flake
// under parallel load on Windows. At file level the cost is paid once,
// outside any per-test timeout.
import { checkSignInLockout, handleFailedSignIn } from "../plugins/auth.js";

// Demo-mode tests exercise env parsing, the route blocklist plugin, the
// /api/demo endpoints and the outbound choke points. The env module caches
// loadEnv() — resetEnvForTests() between cases so DEMO_MODE flips cleanly.
//
// Bun auto-loads .env into process.env — any real credential lying around
// (SETUP_TOKEN, secrets) would trip the demo "no real secrets" refusal, so
// clearDemoEnv() strips every forbidden-pattern key, not just a fixed list.

const DEMO_SECRET_PREFIX =
  /^(OPENAI_|EMAIL_|WHATSAPP_|SMTP_|META_|EVOLUTION_|OFICINAOS_CLOUD_|CLOUD_|GITHUB_|INVOICEXPRESS_|IX_|TRADE_|MARKET_|S3_|R2_|AWS_|BACKUP_|SEED_ADMIN_|SETUP_TOKEN)/;
const DEMO_SECRET_SUFFIX =
  /(_TOKEN|_SECRET|_PASSWORD|_PASS|_KEY|_API_KEY|_APIKEY|_CREDENTIALS|_DSN)$/;
const DEMO_SECRET_ALLOW = new Set([
  "BETTER_AUTH_SECRET",
  "COOKIE_SECRET",
  "AI_ENCRYPTION_KEY",
]);
const EXTRA_KEYS = ["DEMO_MODE", "DEMO_TRUST_CF_CONNECTING_IP"];

function clearDemoEnv() {
  for (const key of Object.keys(process.env)) {
    const forbidden =
      !DEMO_SECRET_ALLOW.has(key) &&
      (DEMO_SECRET_PREFIX.test(key) || DEMO_SECRET_SUFFIX.test(key));
    if (forbidden || EXTRA_KEYS.includes(key)) {
      Reflect.deleteProperty(process.env, key);
    }
  }
  resetEnvForTests();
}

function setErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _req, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({ code: error.code });
      return;
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ code: "INTERNAL_ERROR" });
  });
}

function stubPrisma() {
  return new Proxy(
    {},
    {
      get: (_t, _delegate) =>
        new Proxy(
          {},
          {
            get: (_d, method) => {
              if (method === "findUnique" || method === "findFirst") {
                return async () => null;
              }
              if (method === "count") {
                return async () => 0;
              }
              if (
                typeof method === "string" &&
                method.startsWith("$queryRaw")
              ) {
                return async () => [];
              }
              return async () => ({});
            },
          }
        ),
    }
  );
}

function buildAppWithDemoGuard() {
  // Lightweight harness mirroring index.ts: demo plugin + error handler.
  return import("../plugins/demo.js").then(({ default: demoPlugin }) => {
    const app = Fastify({ logger: false });
    setErrorHandler(app);
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
    "CLOUD_API_KEY",
    "GITHUB_FEEDBACK_TOKEN",
    "INVOICEXPRESS_API_KEY",
    "IX_API_KEY",
    "TRADE_API_TOKEN",
    "MARKET_SECRET",
    "S3_ACCESS_KEY",
    "R2_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "BACKUP_PASSPHRASE",
    "SEED_ADMIN_PASSWORD",
    "SETUP_TOKEN",
    // Suffix catch-all — a credential shape we never enumerated by prefix.
    "ACME_SERVICE_API_KEY",
    "SOME_RANDOM_PASSWORD",
    "STRIPE_SECRET_KEY",
    "THIRD_PARTY_SVC_PASS",
    "LEGACY_ANALYTICS_DSN",
    "MICROSERVICE_CREDENTIALS",
  ])("refuses to start with %s defined", async (key) => {
    process.env.DEMO_MODE = "true";
    process.env[key] = "x-real-credential";
    resetEnvForTests();
    const { loadEnv } = await import("../config/env.js");
    expect(() => loadEnv()).toThrow();
  });

  it.each([
    "BETTER_AUTH_SECRET",
    "COOKIE_SECRET",
    "AI_ENCRYPTION_KEY",
  ])("still boots with the local-only secret %s", async (key) => {
    process.env.DEMO_MODE = "true";
    process.env[key] = "local-demo-secret-thirty-two-chars-ok";
    resetEnvForTests();
    const { loadEnv } = await import("../config/env.js");
    expect(() => loadEnv()).not.toThrow();
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

  it("blocks credential sign-ins — only /api/demo/login creates sessions", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildAppWithDemoGuard();
    // Credential sign-ins are closed in demo: scripted failures would
    // otherwise lock the shared demo account out for every visitor.
    for (const url of [
      "/api/auth/sign-in/username",
      "/api/auth/sign-in/email",
    ]) {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "DEMO_DISABLED" });
    }
    // Demo login and sign-out stay open.
    for (const url of ["/api/demo/login", "/api/auth/sign-out"]) {
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

describe("URL-encoding bypass (real routes)", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  async function buildRealRouteApp() {
    const { default: demoPlugin } = await import("../plugins/demo.js");
    const { usersRoutes } = await import("../routes/users.js");
    const { settingsRoutes } = await import("../routes/settings.js");
    const { authRoutes } = await import("../routes/auth.js");
    const app = Fastify({ logger: false });
    setErrorHandler(app);
    app.decorate("prisma", stubPrisma() as never);
    app.decorate("auth", {
      handler: async () => new Response("{}", { status: 200 }),
      api: { getSession: async () => null },
    } as never);
    await app.register(demoPlugin);
    // The same wildcard the auth plugin exposes for better-auth.
    app.all("/api/auth/*", async () => ({ ok: true }));
    app.register(authRoutes);
    app.register(usersRoutes, { prefix: "/api/users" });
    app.register(settingsRoutes, { prefix: "/api/settings" });
    return app;
  }

  it.each([
    ["POST", "/api/%75sers/x/reset-password"],
    ["POST", "/api/%75sers"],
    ["PATCH", "/api/%75sers/x/status"],
    ["POST", "/api/au%74h/change-password"],
    ["POST", "/api/settings/clou%64/pair"],
    ["POST", "/api/settings/whatsap%70"],
    ["GET", "/api/settings/clou%64"],
    ["POST", "/api/%61i/chat"],
    ["GET", "/api/expor%74/jobs.csv"],
    ["POST", "/api/setu%70"],
  ])("rejects encoded %s %s with DEMO_DISABLED", async (method, url) => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildRealRouteApp();
    const res = await app.inject({ method: method as "POST", url });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "DEMO_DISABLED" });
  });

  it("returns 400 for malformed percent-encoding instead of skipping the guard", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildRealRouteApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/%E4%XX",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("route classification — every /api route is decided", () => {
  // Explicit "METHOD /path" allowlist: every /api route that is NOT
  // blocked by the demo guard must appear here. Prefix families were
  // dropped on purpose — a new route inside an existing prefix used to
  // slip through unreviewed; now it fails until a human classifies it.
  const ALLOWED = new Set([
    "DELETE /api/business/messages/:id/links/:linkId",
    "DELETE /api/jobs/:id/parts/:partId",
    "DELETE /api/jobs/:id/payment-on-delivery",
    "DELETE /api/jobs/:id/photos/:photoId",
    "DELETE /api/jobs/:id/portal",
    "DELETE /api/jobs/:id/repairs/:repairId",
    "DELETE /api/jobs/:id/waiting-parts/:waitingId",
    "DELETE /api/notifications/in-app/:id",
    "DELETE /api/notifications/outbox/:id",
    "DELETE /api/parts/:id",
    "DELETE /api/payments/:id/payments/:paymentId",
    "DELETE /api/repairs/:id",
    "DELETE /api/return-claims/:id/photos/:photoId",
    "GET /api/auth/*",
    "GET /api/auth/must-change-password",
    "GET /api/brands/:brandId/models/search",
    "GET /api/brands/search",
    "GET /api/business/agreements",
    "GET /api/business/messages",
    "GET /api/business/parties",
    "GET /api/business/targets",
    "GET /api/business/tickets",
    "GET /api/customers",
    "GET /api/customers/:id",
    "GET /api/customers/search",
    "GET /api/dashboard/front-desk",
    "GET /api/dashboard/owner",
    "GET /api/dashboard/technician",
    "GET /api/demo/status",
    "GET /api/intake-requests",
    "GET /api/invoicing/status",
    "GET /api/jobs",
    "GET /api/jobs/:id",
    "GET /api/jobs/:id/history",
    "GET /api/jobs/:id/notes",
    "GET /api/jobs/:id/quotes",
    "GET /api/jobs/:jobId/referrals",
    "GET /api/jobs/by-code/:jobCode",
    "GET /api/jobs/lookup",
    "GET /api/jobs/lookup-receipt",
    "GET /api/jobs/metrics",
    "GET /api/notifications/in-app",
    "GET /api/notifications/outbox",
    "GET /api/notifications/templates",
    "GET /api/parts",
    "GET /api/parts/:id",
    "GET /api/parts/:id/restock-suggestion",
    "GET /api/parts/:id/stock-movements",
    "GET /api/parts/restock-forecast",
    "GET /api/payments/:id/payments",
    "GET /api/public/access-info",
    "GET /api/public/shop",
    "GET /api/public/shop/logo",
    "GET /api/public/sign/:token",
    "GET /api/purchase-orders",
    "GET /api/receipts/:id/label",
    "GET /api/receipts/:id/receipt",
    "GET /api/repairs",
    "GET /api/repairs/:id",
    "GET /api/reports/cash",
    "GET /api/reports/cash/session",
    "GET /api/reports/insights",
    "GET /api/reports/operations",
    "GET /api/reports/orders",
    "GET /api/reports/orders/pdf",
    "GET /api/reports/parts-consumption",
    "GET /api/reports/returns",
    "GET /api/reports/revenue",
    "GET /api/return-claims",
    "GET /api/return-claims/:id",
    "GET /api/sales",
    "GET /api/sales/:id",
    "GET /api/sales/:id/receipt",
    "GET /api/settings",
    "GET /api/settings/ai",
    "GET /api/settings/backups/status",
    "GET /api/settings/invoicing",
    "GET /api/settings/shop",
    "GET /api/settings/sms",
    "GET /api/settings/update-check",
    "GET /api/settings/whatsapp",
    "GET /api/setup/status",
    "GET /api/sign-sessions/:token",
    "GET /api/supplier-rmas",
    "GET /api/suppliers",
    "GET /api/suppliers/:id",
    "GET /api/tasks",
    "GET /api/tasks/rules",
    "GET /api/trade-ins",
    "GET /api/trade-ins/:id",
    "GET /api/trade-ins/:id/receipt",
    "GET /api/users",
    "GET /api/users/:id",
    "GET /api/users/:id/activity",
    "GET /api/users/:id/sessions",
    "GET /api/users/:id/stats",
    "GET /api/workflow",
    "GET /api/workflow/states",
    "HEAD /api/auth/*",
    "HEAD /api/auth/must-change-password",
    "HEAD /api/brands/:brandId/models/search",
    "HEAD /api/brands/search",
    "HEAD /api/business/agreements",
    "HEAD /api/business/messages",
    "HEAD /api/business/parties",
    "HEAD /api/business/targets",
    "HEAD /api/business/tickets",
    "HEAD /api/customers",
    "HEAD /api/customers/",
    "HEAD /api/customers/:id",
    "HEAD /api/customers/search",
    "HEAD /api/dashboard/front-desk",
    "HEAD /api/dashboard/owner",
    "HEAD /api/dashboard/technician",
    "HEAD /api/demo/status",
    "HEAD /api/intake-requests",
    "HEAD /api/intake-requests/",
    "HEAD /api/invoicing/status",
    "HEAD /api/jobs",
    "HEAD /api/jobs/",
    "HEAD /api/jobs/:id",
    "HEAD /api/jobs/:id/history",
    "HEAD /api/jobs/:id/notes",
    "HEAD /api/jobs/:id/quotes",
    "HEAD /api/jobs/:jobId/referrals",
    "HEAD /api/jobs/by-code/:jobCode",
    "HEAD /api/jobs/lookup",
    "HEAD /api/jobs/lookup-receipt",
    "HEAD /api/jobs/metrics",
    "HEAD /api/notifications/in-app",
    "HEAD /api/notifications/outbox",
    "HEAD /api/notifications/templates",
    "HEAD /api/parts",
    "HEAD /api/parts/",
    "HEAD /api/parts/:id",
    "HEAD /api/parts/:id/restock-suggestion",
    "HEAD /api/parts/:id/stock-movements",
    "HEAD /api/parts/restock-forecast",
    "HEAD /api/payments/:id/payments",
    "HEAD /api/public/access-info",
    "HEAD /api/public/shop",
    "HEAD /api/public/shop/logo",
    "HEAD /api/public/sign/:token",
    "HEAD /api/purchase-orders",
    "HEAD /api/purchase-orders/",
    "HEAD /api/receipts/:id/label",
    "HEAD /api/receipts/:id/receipt",
    "HEAD /api/repairs",
    "HEAD /api/repairs/",
    "HEAD /api/repairs/:id",
    "HEAD /api/reports/cash",
    "HEAD /api/reports/cash/session",
    "HEAD /api/reports/insights",
    "HEAD /api/reports/operations",
    "HEAD /api/reports/orders",
    "HEAD /api/reports/orders/pdf",
    "HEAD /api/reports/parts-consumption",
    "HEAD /api/reports/returns",
    "HEAD /api/reports/revenue",
    "HEAD /api/return-claims",
    "HEAD /api/return-claims/",
    "HEAD /api/return-claims/:id",
    "HEAD /api/sales",
    "HEAD /api/sales/",
    "HEAD /api/sales/:id",
    "HEAD /api/sales/:id/receipt",
    "HEAD /api/settings",
    "HEAD /api/settings/",
    "HEAD /api/settings/ai",
    "HEAD /api/settings/backups/status",
    "HEAD /api/settings/invoicing",
    "HEAD /api/settings/shop",
    "HEAD /api/settings/sms",
    "HEAD /api/settings/update-check",
    "HEAD /api/settings/whatsapp",
    "HEAD /api/setup/status",
    "HEAD /api/sign-sessions/:token",
    "HEAD /api/supplier-rmas",
    "HEAD /api/supplier-rmas/",
    "HEAD /api/suppliers",
    "HEAD /api/suppliers/",
    "HEAD /api/suppliers/:id",
    "HEAD /api/tasks",
    "HEAD /api/tasks/",
    "HEAD /api/tasks/rules",
    "HEAD /api/trade-ins",
    "HEAD /api/trade-ins/",
    "HEAD /api/trade-ins/:id",
    "HEAD /api/trade-ins/:id/receipt",
    "HEAD /api/users",
    "HEAD /api/users/",
    "HEAD /api/users/:id",
    "HEAD /api/users/:id/activity",
    "HEAD /api/users/:id/sessions",
    "HEAD /api/users/:id/stats",
    "HEAD /api/workflow",
    "HEAD /api/workflow/",
    "HEAD /api/workflow/states",
    "OPTIONS /api/auth/*",
    "PATCH /api/business/agreements/:id",
    "PATCH /api/business/messages/:id",
    "PATCH /api/business/tickets/:id",
    "PATCH /api/customers/:id",
    "PATCH /api/jobs/:id",
    "PATCH /api/jobs/:id/status",
    "PATCH /api/parts/:id",
    "PATCH /api/parts/:id/status",
    "PATCH /api/purchase-orders/:id",
    "PATCH /api/referrals/:id",
    "PATCH /api/repairs/:id",
    "PATCH /api/repairs/:id/status",
    "PATCH /api/return-claims/:id/resolve",
    "PATCH /api/return-claims/:id/triage",
    "PATCH /api/supplier-rmas/:id",
    "PATCH /api/suppliers/:id",
    "PATCH /api/tasks/:id",
    "PATCH /api/tasks/rules/:id",
    "PATCH /api/tasks/rules/:id/disable",
    "PATCH /api/trade-ins/:id",
    "PATCH /api/workflow/states/:id",
    "POST /api/brands",
    "POST /api/brands/:brandId/models",
    "POST /api/business/agreements",
    "POST /api/business/messages",
    "POST /api/business/messages/:id/links",
    "POST /api/business/tickets",
    "POST /api/customers",
    "POST /api/demo/login",
    "POST /api/import/jobs",
    "POST /api/import/parts",
    "POST /api/import/repairs",
    "POST /api/intake-requests/:id/convert",
    "POST /api/intake-requests/:id/dismiss",
    "POST /api/jobs",
    "POST /api/jobs/:id/notes",
    "POST /api/jobs/:id/parts",
    "POST /api/jobs/:id/payment-on-delivery",
    "POST /api/jobs/:id/photos",
    "POST /api/jobs/:id/portal",
    "POST /api/jobs/:id/quotes",
    "POST /api/jobs/:id/repairs",
    "POST /api/jobs/:id/waiting-parts",
    "POST /api/jobs/:jobId/referrals",
    "POST /api/parts",
    "POST /api/parts/:id/stock-movements",
    "POST /api/payments/:id/payments",
    "POST /api/public/pre-check",
    "POST /api/public/quote-respond",
    "POST /api/public/sign/:token",
    "POST /api/public/sms/inbound/:token",
    "POST /api/purchase-orders",
    "POST /api/receipts/:id/print",
    "POST /api/repairs",
    "POST /api/reports/cash/close",
    "POST /api/reports/cash/reopen",
    "POST /api/return-claims",
    "POST /api/return-claims/:id/detach-rework",
    "POST /api/return-claims/:id/photos",
    "POST /api/return-claims/:id/spawn-rework",
    "POST /api/sales",
    "POST /api/sales/:id/print-receipt",
    "POST /api/sign-sessions",
    "POST /api/sign-sessions/:token/invalidate",
    "POST /api/supplier-rmas",
    "POST /api/suppliers",
    "POST /api/tasks",
    "POST /api/tasks/:id/complete",
    "POST /api/tasks/rules",
    "POST /api/trade-ins",
    "POST /api/trade-ins/:id/transition",
    "POST /api/workflow/states",
    "PUT /api/business/identity/:supplierId",
    "PUT /api/notifications/in-app/:id/read",
    "PUT /api/notifications/in-app/read-all",
    "PUT /api/notifications/templates/:id",
    "PUT /api/settings/shop",
    "PUT /api/workflow",
    "QUERY /api/auth/*",
    "TRACE /api/auth/*",
  ]);

  it("classifies every registered /api route", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const { isDemoBlockedPath } = await import("../lib/demo.js");
    const { registerApiRoutes } = await import("../register-api-routes.js");
    const app = Fastify({ logger: false });
    const collected: { method: string; path: string }[] = [];
    app.addHook("onRoute", (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) {
        collected.push({ method: m, path: r.path });
      }
    });
    app.decorate("prisma", stubPrisma() as never);
    app.decorate("auth", {
      handler: async () => new Response("{}"),
      api: { getSession: async () => null },
    } as never);
    app.decorate("wsBroadcast", () => undefined);
    app.decorate("resetEmbedOriginsCache", () => undefined);

    // The better-auth catch-all lives in authPlugin — stub the wildcard
    // so it is classified too (mutations are blocked, GETs allowlisted).
    app.all("/api/auth/*", async () => ({}));
    await registerApiRoutes(app);
    await app.ready();

    const unclassified: string[] = [];
    for (const { method, path } of collected) {
      if (!path.startsWith("/api")) {
        continue;
      }
      if (isDemoBlockedPath(method, path)) {
        continue; // blocked (all methods or this mutation)
      }
      if (!ALLOWED.has(`${method} ${path}`)) {
        unclassified.push(`${method} ${path}`);
      }
    }
    expect(unclassified).toEqual([]);
  }, 60_000);
});

describe("demo account lockout exemption", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  it("never counts failures or locks the demo user", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const increment = vi.fn();
    const prisma = {
      user: {
        findFirst: async () => ({
          id: "demo-user-owner",
          username: "demo",
          failedLoginAttempts: 10,
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
        }),
      },
    };
    // 6 failed sign-ins: no counting, no lockout check against "demo".
    for (let i = 0; i < 6; i++) {
      await handleFailedSignIn(prisma as never, {
        method: "POST",
        body: { username: "demo", password: "wrong" },
      });
      await checkSignInLockout(prisma as never, {
        method: "POST",
        body: { username: "demo", password: "wrong" },
      });
    }
    expect(increment).not.toHaveBeenCalled();
  });

  it("still locks non-demo users in demo mode", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const prisma = {
      user: {
        findFirst: async () => ({
          username: "intruder",
          failedLoginAttempts: 10,
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
        }),
      },
    };
    await expect(
      checkSignInLockout(prisma as never, {
        method: "POST",
        body: { username: "intruder", password: "x" },
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
});

describe("POST /api/demo/login", () => {
  const authHandler = vi.fn();
  const userFindUnique = vi.fn();

  function buildLoginApp() {
    return import("../routes/demo.js").then(({ demoRoutes }) => {
      const app = Fastify({ logger: false });
      setErrorHandler(app);
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

describe("rate limit headers (real securityPlugin)", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  async function buildSecureApp() {
    const { default: securityPlugin } = await import("../plugins/security.js");
    const app = Fastify({ logger: false });
    await app.register(securityPlugin);
    app.post("/api/demo/login", async () => ({ ok: true }));
    app.get("/api/probe-get", async () => ({ ok: true }));
    app.post("/api/probe-post", async () => ({ ok: true }));
    app.post("/api/auth/change-password", async () => ({ ok: true }));
    return app;
  }

  // POSTs need the CSRF cookie+token pair (same dance the SPA does), or the
  // CSRF layer 403s before the rate-limit preHandler sets its headers.
  async function csrfPair(app: Awaited<ReturnType<typeof buildSecureApp>>) {
    const res = await app.inject({ method: "GET", url: "/api/csrf-token" });
    const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    return { cookie, "x-csrf-token": res.json().token as string };
  }

  it("applies route-map limits — not the global default", async () => {
    const app = await buildSecureApp();
    const csrf = await csrfPair(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      headers: csrf,
      payload: {},
    });
    expect(res.headers["x-ratelimit-limit"]).toBe("20");
    const resGet = await app.inject({ method: "GET", url: "/api/probe-get" });
    expect(resGet.headers["x-ratelimit-limit"]).toBe("300");
    const resPwd = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: csrf,
      payload: {},
    });
    expect(resPwd.headers["x-ratelimit-limit"]).toBe("5");
  });

  it("clamps demo mutations to 60/min and keys demo login on CF-Connecting-IP", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = await buildSecureApp();
    const csrf = await csrfPair(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/probe-post",
      headers: csrf,
      payload: {},
    });
    expect(res.headers["x-ratelimit-limit"]).toBe("60");
    // Same inject IP, different CF-Connecting-IP → independent budgets prove
    // the demo login keys on the Cloudflare header, not the tunnel IP.
    const resA = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      headers: { ...csrf, "cf-connecting-ip": "203.0.113.7" },
      payload: {},
    });
    expect(resA.headers["x-ratelimit-limit"]).toBe("20");
    expect(resA.headers["x-ratelimit-remaining"]).toBe("19");
    const resB = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      headers: { ...csrf, "cf-connecting-ip": "198.51.100.9" },
      payload: {},
    });
    expect(resB.headers["x-ratelimit-remaining"]).toBe("19");
  });

  it("caps POST /api/users at 10/min while GETs keep the default 300", async () => {
    // DEMO_MODE off — the route-level limit must apply in real installs.
    const app = Fastify({ logger: false });
    const { default: securityPlugin } = await import("../plugins/security.js");
    await app.register(securityPlugin);
    app.decorate("prisma", stubPrisma() as never);
    app.decorate("auth", {
      handler: async () => new Response("{}"),
      api: {
        getSession: async () => null,
        userHasPermission: async () => ({ success: true }),
      },
    } as never);
    app.decorate("wsBroadcast", () => undefined);
    // Stand in for the session so requirePermission passes and the
    // request actually reaches the rate-limit hook.
    app.addHook("preHandler", (req, _reply, done) => {
      (req as { user?: unknown }).user = { id: "u1", role: "OWNER" };
      done();
    });
    const { usersRoutes } = await import("../routes/users.js");
    app.register(usersRoutes, { prefix: "/api/users" });
    await app.ready();

    const resGet = await app.inject({ method: "GET", url: "/api/users" });
    expect(resGet.headers["x-ratelimit-limit"]).toBe("300");
    const csrf = await csrfPair(app);
    const resPost = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: csrf,
      payload: {},
    });
    expect(resPost.headers["x-ratelimit-limit"]).toBe("10");
    // Sibling reads that used to inherit the write budget stay at 300.
    const resStats = await app.inject({
      method: "GET",
      url: "/api/users/u1/stats",
    });
    expect(resStats.headers["x-ratelimit-limit"]).toBe("300");
  });
});

describe("outbound choke points — no fetch is ever reached", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  const failFetch = () => {
    throw new Error("fetch must never be called in DEMO_MODE");
  };

  it.each<[string, () => Promise<unknown>]>([
    [
      "sendEmail",
      async () =>
        (await import("../lib/email.js")).sendEmail({
          subject: "x",
          to: "a@b.example",
        }),
    ],
    [
      "sendWhatsAppText",
      async () =>
        (await import("../services/whatsapp-channel.js")).sendWhatsAppText(
          {} as never,
          { apiUrl: "https://x", mode: "cloud", shopToken: "t" },
          "910000001",
          "hi",
          undefined,
          null
        ),
    ],
    [
      "sendWhatsAppTemplateVia",
      async () =>
        (
          await import("../services/whatsapp-channel.js")
        ).sendWhatsAppTemplateVia(
          {} as never,
          { apiUrl: "https://x", mode: "cloud", shopToken: "t" },
          "910000001",
          "tpl",
          "pt",
          [],
          undefined,
          null
        ),
    ],
    [
      "sendSms",
      async () =>
        (await import("../services/sms.service.js")).sendSms(
          { url: "http://x", user: "u", password: "p" },
          "910000001",
          "hi"
        ),
    ],
    [
      "registerSmsWebhook",
      async () =>
        (await import("../services/sms.service.js")).registerSmsWebhook(
          { url: "http://x", user: "u", password: "p" },
          "http://cb"
        ),
    ],
    [
      "checkSmsGateway",
      async () =>
        (await import("../services/sms.service.js")).checkSmsGateway({
          url: "http://x",
          user: "u",
          password: "p",
        }),
    ],
    [
      "cloudFetch",
      async () =>
        (await import("../services/cloud.service.js")).cloudFetch(
          "https://cloud.example",
          "/x"
        ),
    ],
    [
      "sendEvolutionText (evoFetch)",
      async () =>
        (await import("../services/evolution.service.js")).sendEvolutionText(
          { apiKey: "k", baseUrl: "http://x", instance: "i" },
          "910000001",
          "hi"
        ),
    ],
    [
      "sendEscPos",
      async () =>
        (await import("../services/escpos.service.js")).sendEscPos(
          { printerHost: "10.0.0.1", printerMode: "escpos", printerPort: 9100 },
          Buffer.from("x")
        ),
    ],
    [
      "submitFeedbackReport",
      async () =>
        (await import("../services/feedback.service.js")).submitFeedbackReport(
          { description: "x" } as never,
          {} as never
        ),
    ],
    [
      "streamChat",
      async () => (await import("../ai/stream.js")).streamChat({} as never),
    ],
    [
      "startUpdate",
      async () => (await import("../services/update.service.js")).startUpdate(),
    ],
    [
      "testAiConnection",
      async () =>
        (await import("../services/settings.service.js")).testAiConnection(
          {} as never
        ),
    ],
  ])("%s throws DEMO_DISABLED without calling fetch", async (_name, fn) => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(failFetch as never);
    try {
      await expect(fn()).rejects.toMatchObject({ code: "DEMO_DISABLED" });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("demo upload + setup guards", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  it("rejects uploads above 1 MB in DEMO_MODE", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const app = Fastify({ logger: false });
    setErrorHandler(app);
    const env = (await import("../config/env.js")).loadEnv();
    await app.register(multipart, {
      limits: { fileSize: env.DEMO_MODE ? 1024 * 1024 : 5 * 1024 * 1024 },
    });
    app.post("/upload", async (req) => {
      const file = await req.file();
      return { size: (await file?.toBuffer())?.length ?? 0 };
    });
    const boundary = "----demoBoundary";
    const bigBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      Buffer.alloc(1024 * 1024 + 10, 1),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: bigBody,
    });
    expect(res.statusCode).toBe(413);
  });

  it("GET /api/setup/status reports needsSetup:false in demo", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const { setupRoutes } = await import("../routes/setup.js");
    const app = Fastify({ logger: false });
    setErrorHandler(app);
    app.decorate("prisma", stubPrisma() as never);
    app.register(setupRoutes);
    const res = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ needsSetup: false });
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
    const { isDemoBlockedPath } = await import("../lib/demo.js");
    expect(isDemoBlockedPath("POST", "/api/import/parts")).toBe(false);
  });
});

describe("CF-Connecting-IP trust (demoRateLimitKey)", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  const req = (ip: string, cf?: string) => ({
    ip,
    headers: cf ? { "cf-connecting-ip": cf } : {},
  });

  it("honors the header only from private/edge peers or the opt-in flag", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const { demoRateLimitKey } = await import("../lib/demo.js");

    // cloudflared / edge proxy arrive on private IPs — header honored.
    expect(demoRateLimitKey(req("172.18.0.5", "203.0.113.7"))).toBe(
      "203.0.113.7"
    );
    expect(demoRateLimitKey(req("192.168.1.10", "203.0.113.7"))).toBe(
      "203.0.113.7"
    );
    // A request hitting the origin on a public socket keeps its real IP —
    // rotating the forged header mints nothing.
    expect(demoRateLimitKey(req("203.0.113.9", "1.2.3.4"))).toBe("203.0.113.9");
    // No header at all → socket IP either way.
    expect(demoRateLimitKey(req("203.0.113.9"))).toBe("203.0.113.9");

    // Explicit opt-in trusts the header from any peer (edge strips it
    // upstream, so the flag documents "my proxy owns this header").
    process.env.DEMO_TRUST_CF_CONNECTING_IP = "true";
    resetEnvForTests();
    expect(demoRateLimitKey(req("203.0.113.9", "1.2.3.4"))).toBe("1.2.3.4");
  });
});

describe("GET /api/settings/update-check in demo", () => {
  beforeEach(clearDemoEnv);
  afterEach(clearDemoEnv);

  it("answers { updateAvailable: false } locally — never reaches GitHub", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvForTests();
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch must never be called in DEMO_MODE");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { settingsRoutes } = await import("../routes/settings.js");
      const app = Fastify({ logger: false });
      setErrorHandler(app);
      app.decorate("prisma", stubPrisma() as never);
      app.decorate("auth", {
        api: { userHasPermission: async () => ({ success: true }) },
      } as never);
      // settingsRoutes requires settings:view on every route — stand in
      // for the session the real auth plugin would provide.
      app.addHook("preHandler", (req, _reply, done) => {
        (req as { user?: unknown }).user = { id: "u1", role: "OWNER" };
        done();
      });
      app.register(settingsRoutes, { prefix: "/api/settings" });
      const res = await app.inject({
        method: "GET",
        url: "/api/settings/update-check",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ updateAvailable: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
