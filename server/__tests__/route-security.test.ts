import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECURITY,
  matchRoute,
  mergeRouteConfig,
  type RouteSecurityOverride,
  routeSecurity,
} from "../../server/config/route-security.js";

describe("matchRoute", () => {
  it("matches exact paths", () => {
    expect(matchRoute("/health", routeSecurity)).toBeDefined();
    expect(matchRoute("/health", routeSecurity)?.csrf).toBe(false);
  });

  it("matches wildcard patterns", () => {
    expect(matchRoute("/api/auth/sign-in", routeSecurity)?.csrf).toBe(false);
    expect(matchRoute("/api/auth/anything", routeSecurity)?.csrf).toBe(false);
  });

  it("returns first match (more specific wins)", () => {
    const result = matchRoute("/api/auth/change-password", routeSecurity);
    expect(result?.allowSensitiveKeys).toBe(true);
    expect(result?.rateLimit).toEqual({ max: 5, timeWindow: "1 minute" });
  });

  it("returns empty config for fallback catch-all routes", () => {
    const result = matchRoute("/api/unknown/route", routeSecurity);
    expect(result).toBeDefined();
    expect(result?.csrf).toBeUndefined();
    expect(result?.rateLimit).toBeUndefined();
    expect(result?.allowSensitiveKeys).toBeUndefined();
  });

  it("returns undefined for non-API routes with no matching pattern", () => {
    expect(matchRoute("/nonexistent", routeSecurity)).toBeUndefined();
  });

  it("does not match partial segments", () => {
    const customRules: [string, RouteSecurityOverride][] = [
      ["/api/auth/*", { csrf: false }],
    ];
    expect(matchRoute("/api/authx/sign-in", customRules)).toBeUndefined();
  });

  it("wildcard matches any single segment", () => {
    expect(matchRoute("/api/jobs", routeSecurity)).toBeDefined();
    expect(matchRoute("/api/parts", routeSecurity)).toBeDefined();
  });

  it("matches :param segments as wildcards", () => {
    expect(
      matchRoute("/api/users/42/reset-password", routeSecurity)
    ).toBeDefined();
    expect(
      matchRoute("/api/users/42/reset-password", routeSecurity)
        ?.allowSensitiveKeys
    ).toBe(true);
    expect(matchRoute("/api/users/99/status", routeSecurity)).toBeDefined();
  });

  it("prefix-matches parent routes to sub-routes", () => {
    const jobsOverride = matchRoute("/api/jobs", routeSecurity);
    expect(jobsOverride?.rateLimit).toEqual({
      max: 300,
      timeWindow: "1 minute",
    });

    const jobsSub = matchRoute("/api/jobs/abc-123", routeSecurity);
    expect(jobsSub?.rateLimit).toEqual({ max: 300, timeWindow: "1 minute" });

    const jobsDeep = matchRoute("/api/jobs/abc-123/status", routeSecurity);
    expect(jobsDeep?.rateLimit).toEqual({ max: 300, timeWindow: "1 minute" });

    const jobsNotes = matchRoute("/api/jobs/abc-123/notes", routeSecurity);
    expect(jobsNotes?.rateLimit).toEqual({ max: 300, timeWindow: "1 minute" });
  });

  it("does not match shorter URLs against longer patterns", () => {
    expect(matchRoute("/api", routeSecurity)).toBeUndefined();
    expect(matchRoute("/", routeSecurity)).toBeUndefined();
  });

  it("auth wildcard routes allow sensitive keys", () => {
    expect(
      matchRoute("/api/auth/sign-in/email", routeSecurity)?.allowSensitiveKeys
    ).toBe(true);
    expect(
      matchRoute("/api/auth/sign-up/email", routeSecurity)?.allowSensitiveKeys
    ).toBe(true);
  });
});

describe("mergeRouteConfig", () => {
  /** The effective config a route ends up with, as the onRoute hook builds it. */
  const effective = (url: string, routeConfig?: Record<string, unknown>) =>
    mergeRouteConfig(routeConfig, matchRoute(url, routeSecurity));

  it("applies the central map when a route declares no config", () => {
    const merged = effective("/api/jobs");
    expect(merged.rateLimit).toEqual({ max: 300, timeWindow: "1 minute" });
    expect(merged.allowSensitiveKeys).toBe(false);
  });

  it("keeps the strict limit on the public job lookup", () => {
    // Regression: the generic /api/jobs rule used to overwrite this, handing
    // an unauthenticated endpoint 30 attempts/min instead of 10 per 15 min.
    const rateLimit = effective("/api/jobs/lookup").rateLimit as {
      keyGenerator: (req: { ip: string }) => string;
      max: number;
      timeWindow: string;
    };
    expect(rateLimit.max).toBe(10);
    expect(rateLimit.timeWindow).toBe("15 minutes");
    expect(rateLimit.keyGenerator({ ip: "10.0.0.1" })).toBe("10.0.0.1");
  });

  it("keeps the strict limit on AI streaming", () => {
    expect(effective("/api/ai/chat/stream").rateLimit).toEqual({
      max: 10,
      timeWindow: "1 minute",
    });
  });

  it("does not let a route-declared rateLimit be discarded", () => {
    const declared = { max: 5, timeWindow: "1 hour" };
    const merged = effective("/api/jobs", { rateLimit: declared });
    expect(merged.rateLimit).toBe(declared);
  });

  it("still inherits non-overridden keys from the map", () => {
    const merged = effective("/api/auth/sign-in/email", {
      rateLimit: { max: 1, timeWindow: "1 hour" },
    });
    expect(merged.rateLimit).toEqual({ max: 1, timeWindow: "1 hour" });
    expect(merged.allowSensitiveKeys).toBe(true);
  });

  it("honours an explicit rateLimit:false from the map", () => {
    expect(effective("/health").rateLimit).toBe(false);
  });
});

describe("DEFAULT_SECURITY", () => {
  it("has correct defaults", () => {
    expect(DEFAULT_SECURITY.rateLimit).toEqual({
      max: 300,
      timeWindow: "1 minute",
    });
    expect(DEFAULT_SECURITY.csrf).toBeUndefined();
    expect(DEFAULT_SECURITY.allowSensitiveKeys).toBe(false);
  });
});
