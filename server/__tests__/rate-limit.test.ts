import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  buildRateLimitError,
  CappedBackoffStore,
  isRateLimitExempt,
  MAX_RATE_LIMIT_BACKOFF_MS,
} from "../lib/rate-limit.js";
import { cacheControlFor, IMMUTABLE_CACHE } from "../lib/static-cache.js";
import securityPlugin from "../plugins/security.js";

// The real security plugin (global limit: 300 req/min) on a bare app, so the
// assertions cover the exact options production registers.
async function buildApp() {
  const app = Fastify();
  await app.register(securityPlugin);
  app.get("/api/ping", async () => ({ ok: true }));
  app.get("/assets/app-ABC123.js", async () => "console.log(1)");
  await app.ready();
  return app;
}

describe("isRateLimitExempt", () => {
  it("exempts static assets, the SPA shell and /health", () => {
    expect(isRateLimitExempt({ method: "GET", url: "/assets/a-1.js" })).toBe(
      true
    );
    expect(isRateLimitExempt({ method: "GET", url: "/jobs/123" })).toBe(true);
    expect(isRateLimitExempt({ method: "HEAD", url: "/favicon.svg" })).toBe(
      true
    );
    expect(isRateLimitExempt({ method: "GET", url: "/health" })).toBe(true);
  });

  it("keeps API calls, the websocket and non-GET requests limited", () => {
    expect(isRateLimitExempt({ method: "GET", url: "/api/jobs" })).toBe(false);
    expect(isRateLimitExempt({ method: "GET", url: "/ws" })).toBe(false);
    expect(isRateLimitExempt({ method: "POST", url: "/assets/x.js" })).toBe(
      false
    );
  });
});

describe("CappedBackoffStore", () => {
  it("never stores a window longer than the cap, however long the abuse", () => {
    const store = new CappedBackoffStore({ exponentialBackoff: true });
    let last = { current: 0, ttl: 0 };
    // 1 req/min budget, 80 requests: uncapped this reaches 60s · 2^78.
    for (let i = 0; i < 80; i++) {
      store.incr(
        "k",
        (_err, res) => {
          last = res;
        },
        60_000,
        1
      );
    }
    expect(last.ttl).toBe(MAX_RATE_LIMIT_BACKOFF_MS);
    let peek = { current: 0, ttl: Number.POSITIVE_INFINITY };
    store.read(
      "k",
      (_err, res) => {
        peek = res;
      },
      60_000,
      1
    );
    expect(peek.ttl).toBeLessThanOrEqual(MAX_RATE_LIMIT_BACKOFF_MS);
  });

  it("children keep the cap", () => {
    const child = new CappedBackoffStore({}).child({
      exponentialBackoff: true,
    });
    let last = { current: 0, ttl: 0 };
    for (let i = 0; i < 60; i++) {
      child.incr(
        "k",
        (_err, res) => {
          last = res;
        },
        60_000,
        1
      );
    }
    expect(last.ttl).toBe(MAX_RATE_LIMIT_BACKOFF_MS);
  });
});

describe("buildRateLimitError", () => {
  it("is a 429 RATE_LIMITED with whole seconds, capped", () => {
    const err = buildRateLimitError(
      {} as never,
      { ttl: Number.MAX_SAFE_INTEGER } as never
    );
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.details).toEqual({ retryAfter: 900 });
  });
});

describe("global rate limit (security plugin)", () => {
  it("answers 429 with Retry-After and a JSON body once the budget is spent", async () => {
    const app = await buildApp();
    let res = await app.inject("/api/ping");
    for (let i = 0; i < 300 && res.statusCode === 200; i++) {
      res = await app.inject("/api/ping");
    }
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(900);
    const body = res.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.details.retryAfter).toBeGreaterThan(0);

    // Keep hammering into the ban stage: still a 429, never a 403/500, and
    // the advertised wait never exceeds the 15-minute cap.
    for (let i = 0; i < 40; i++) {
      res = await app.inject("/api/ping");
    }
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(900);
    await app.close();
  });

  it("does not count static assets against the budget", async () => {
    const app = await buildApp();
    for (let i = 0; i < 350; i++) {
      const res = await app.inject("/assets/app-ABC123.js");
      expect(res.statusCode).toBe(200);
    }
    const api = await app.inject("/api/ping");
    expect(api.statusCode).toBe(200);
    await app.close();
  });

  it("allows same-origin frames for the print preview", async () => {
    const app = await buildApp();
    const res = await app.inject("/api/ping");
    expect(String(res.headers["content-security-policy"])).toContain(
      "frame-src 'self'"
    );
    await app.close();
  });
});

describe("cacheControlFor", () => {
  it("caches hashed chunks forever and revalidates the shell", () => {
    expect(cacheControlFor("assets/app-ABC123.js")).toBe(IMMUTABLE_CACHE);
    expect(cacheControlFor("index.html")).toBe("no-cache");
    expect(cacheControlFor("sw.js")).toBe("no-cache");
    expect(cacheControlFor("manifest.webmanifest")).toBe("no-cache");
    expect(cacheControlFor("icons/icon-192.png")).toBe("public, max-age=86400");
  });
});
