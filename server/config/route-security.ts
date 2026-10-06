import type { FastifyRequest } from "fastify";

export interface RateLimitConfig {
  keyGenerator?: (req: FastifyRequest) => string;
  max: number;
  timeWindow: string;
}

export interface RouteSecurityOverride {
  allowSensitiveKeys?: boolean;
  csrf?: boolean;
  rateLimit?: RateLimitConfig | false;
}

// Rate-limit keyed on the identifier the attacker is targeting (email/username)
// to prevent one IP from locking a NAT'd office out of sign-in, and to make
// credential-stuffing attacks wait per-account.
const signInKeyGenerator = (req: FastifyRequest): string => {
  const body = req.body as Record<string, unknown> | undefined;
  let identifier = "";
  if (typeof body?.email === "string") {
    identifier = body.email;
  } else if (typeof body?.username === "string") {
    identifier = body.username;
  }
  if (identifier) {
    return `signin:${identifier.toLowerCase().trim()}`;
  }
  return `signin:ip:${req.ip}`;
};

// Public customer tracking is unauthenticated, so it gets the strictest
// budget in the app and always keys on the caller's IP.
const lookupKeyGenerator = (req: FastifyRequest): string => req.ip;

export const DEFAULT_SECURITY: RouteSecurityOverride = {
  rateLimit: { max: 100, timeWindow: "1 minute" },
  allowSensitiveKeys: false,
};

export const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function isMutation(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

export function matchRoute(
  url: string,
  rules: [string, RouteSecurityOverride][]
): RouteSecurityOverride | undefined {
  for (const [pattern, config] of rules) {
    if (routeMatchesPattern(url, pattern)) {
      return config;
    }
  }
  return;
}

/**
 * Resolves a route's effective security config: the central map supplies the
 * baseline, and a config declared on the route itself wins key by key.
 *
 * This is the step that used to discard route-level rate limits — the map was
 * spread last, so a route pinning a stricter budget silently inherited the
 * looser parent rule. Keeping it exported and tested is what makes that
 * regression visible.
 *
 * Security limits belong in `routeSecurity` so there is a single place to
 * audit; a route-level override is the more specific author intent.
 */
export function mergeRouteConfig(
  routeConfig: Record<string, unknown> | undefined,
  override: RouteSecurityOverride | undefined
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...DEFAULT_SECURITY,
    ...override,
  };

  // Handle rateLimit: false explicitly (disable rate limit for this route)
  if (override?.rateLimit === false) {
    merged.rateLimit = false;
  }

  return { ...merged, ...routeConfig };
}

function routeMatchesPattern(url: string, pattern: string): boolean {
  const urlSegments = url.split("/");
  const patternSegments = pattern.split("/");

  // URL must have at least as many segments as the pattern
  // (prefix match: /api/jobs matches /api/jobs/:id)
  if (urlSegments.length < patternSegments.length) {
    return false;
  }

  for (let i = 0; i < patternSegments.length; i++) {
    const patSeg = patternSegments[i];
    if (patSeg === "*") {
      continue;
    }
    if (patSeg.startsWith(":")) {
      continue;
    }
    if (urlSegments[i] !== patSeg) {
      return false;
    }
  }

  return true;
}

export const routeSecurity: [string, RouteSecurityOverride][] = [
  ["/health", { rateLimit: false, csrf: false }],
  [
    "/api/csrf-token",
    { rateLimit: { max: 60, timeWindow: "1 minute" }, csrf: false },
  ],
  [
    "/api/auth/change-password",
    {
      rateLimit: { max: 5, timeWindow: "1 minute" },
      allowSensitiveKeys: true,
    },
  ],
  [
    "/api/auth/must-change-password",
    { rateLimit: { max: 20, timeWindow: "1 minute" }, csrf: false },
  ],
  [
    "/api/auth/sign-in/email",
    {
      csrf: false,
      allowSensitiveKeys: true,
      rateLimit: {
        max: 5,
        timeWindow: "5 minute",
        keyGenerator: signInKeyGenerator,
      },
    },
  ],
  [
    "/api/auth/sign-in/username",
    {
      csrf: false,
      allowSensitiveKeys: true,
      rateLimit: {
        max: 5,
        timeWindow: "5 minute",
        keyGenerator: signInKeyGenerator,
      },
    },
  ],
  ["/api/auth/*", { csrf: false, allowSensitiveKeys: true }],
  [
    "/api/users/:id/reset-password",
    {
      rateLimit: { max: 10, timeWindow: "1 minute" },
      allowSensitiveKeys: true,
    },
  ],
  [
    "/api/users/:id/status",
    {
      rateLimit: { max: 30, timeWindow: "1 minute" },
      allowSensitiveKeys: true,
    },
  ],
  [
    "/api/users",
    {
      rateLimit: { max: 10, timeWindow: "1 minute" },
      allowSensitiveKeys: true,
    },
  ],
  // More specific patterns must precede their parent, since the first match wins.
  [
    "/api/jobs/lookup",
    {
      rateLimit: {
        keyGenerator: lookupKeyGenerator,
        max: 10,
        timeWindow: "15 minutes",
      },
    },
  ],
  // Public digital receipt — same identity proof and budget as lookup.
  [
    "/api/jobs/lookup-receipt",
    {
      rateLimit: {
        keyGenerator: lookupKeyGenerator,
        max: 10,
        timeWindow: "15 minutes",
      },
    },
  ],
  // Public quote response shares the tracking identity proof, so it gets the
  // same strict IP budget as the lookup endpoint. csrf:false — anonymous
  // customers have no session/token pair to validate.
  [
    "/api/public/quote-respond",
    {
      csrf: false,
      rateLimit: {
        keyGenerator: lookupKeyGenerator,
        max: 10,
        timeWindow: "15 minutes",
      },
    },
  ],
  // Public pre-check intake — anonymous form submissions, so no CSRF token
  // exists and the budget is tighter than lookup: a real customer submits
  // once, a spammer submits a lot.
  [
    "/api/public/pre-check",
    {
      csrf: false,
      rateLimit: {
        keyGenerator: lookupKeyGenerator,
        max: 5,
        timeWindow: "15 minutes",
      },
    },
  ],
  // SMS inbound webhook — o gateway na LAN não tem sessão nem CSRF token.
  // Budget por IP: um cliente que mande 20 SMS/seg só precisa que cada um
  // chegue uma vez.
  [
    "/api/public/sms/inbound",
    {
      csrf: false,
      rateLimit: {
        keyGenerator: lookupKeyGenerator,
        max: 60,
        timeWindow: "1 minute",
      },
    },
  ],
  ["/api/jobs", { rateLimit: { max: 30, timeWindow: "1 minute" } }],
  // A streaming completion is by far the most expensive request the API serves.
  ["/api/ai/chat/stream", { rateLimit: { max: 10, timeWindow: "1 minute" } }],
  ["/api/ai", { rateLimit: { max: 30, timeWindow: "1 minute" } }],
  // Each report opens a public GitHub issue — keep the budget small.
  ["/api/feedback", { rateLimit: { max: 5, timeWindow: "15 minutes" } }],
  ["/api/*", {}],
];
