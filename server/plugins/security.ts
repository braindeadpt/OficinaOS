import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrf from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { isAppError } from "@shared/errors/app-error.js";
import type {
  FastifyError,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import { loadEnv, resolveUrls } from "../config/env.js";
import {
  DEFAULT_SECURITY,
  isMutation,
  MUTATION_METHODS,
  matchRoute,
  mergeRouteConfig,
  type RouteSecurityOverride,
  routeSecurity,
} from "../config/route-security.js";
import { demoRateLimitKey, isDemoMode } from "../lib/demo.js";
import {
  buildRateLimitError,
  CappedBackoffStore,
  isRateLimitExempt,
} from "../lib/rate-limit.js";

const HTTP_SCHEME_REPLACE = /^http/;

const SENSITIVE_KEYS = new Set(["password", "role", "mustChangePassword"]);

function generateNonce(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

// DEMO_MODE write ceiling — see the onRoute call site below.
const DEMO_MUTATION_MAX_PER_MINUTE = 60;
function clampDemoMutationRateLimit(config: unknown, method: string): void {
  if (!(isDemoMode() && isMutation(method))) {
    return;
  }
  const cfg = config as RouteSecurityOverride | undefined;
  const rl = cfg?.rateLimit;
  if (rl && typeof rl === "object") {
    // Clone before capping — routeSecurity entries are shared objects;
    // mutating them in place would leak the demo ceiling into the map.
    cfg.rateLimit = {
      ...rl,
      max: Math.min(
        rl.max ?? DEMO_MUTATION_MAX_PER_MINUTE,
        DEMO_MUTATION_MAX_PER_MINUTE
      ),
    };
  }
}

// Segment-aware: /embed and /embed/* are iframable widget pages; a sibling
// like /embedxyz is not.
export function isEmbedPath(path: string): boolean {
  return path === "/embed" || path.startsWith("/embed/");
}

const ORIGIN_SPLIT = /[\s,]+/;

/**
 * Parse the shop's embedAllowedOrigins setting (one origin per line) into
 * canonical scheme://host[:port] origins. Anything that isn't a valid
 * http(s) origin is dropped — a typo must not weaken or break the CSP.
 */
export function parseOriginList(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  const origins: string[] = [];
  for (const token of raw.split(ORIGIN_SPLIT)) {
    const t = token.trim();
    if (!t) {
      continue;
    }
    try {
      const url = new URL(t);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.push(url.origin);
      }
    } catch {
      // invalid entry — ignored
    }
  }
  return Array.from(new Set(origins));
}

const EMBED_ORIGINS_TTL_MS = 60_000;

// An origin is only advertised in connect-src to clients that arrived on it.
// This keeps the CSP from leaking other trusted origins (e.g. the LAN
// APP_URL's private IP) to requests that came in via a different host (e.g.
// the public tunnel domain). Same-origin API/WS traffic — all the frontend
// uses (relative /api, /ws on location.host) — is covered by 'self' + ws:/wss:.
export function originMatchesRequestHost(
  origin: string,
  requestHost: string | undefined
): boolean {
  if (!requestHost) {
    return false;
  }
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

const securityPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const env = loadEnv();
  const IS_PROD = env.NODE_ENV === "production";
  // HTTPS on the public origin gates TLS-only headers and cookie flags.
  const IS_HTTPS = (env.APP_URL ?? "").startsWith("https://");

  // frame-ancestors for /embed/* comes from the shop's embedAllowedOrigins
  // setting — a DB read per request would be wasteful, so cache it briefly.
  // The cache is only ever written on success; a DB error falls back to the
  // last good value (or '*' uncached if we never read one).
  let embedOriginsCache: { at: number; value: string } | null = null;
  app.decorate("resetEmbedOriginsCache", () => {
    embedOriginsCache = null;
  });
  async function embedFrameAncestors(request: FastifyRequest): Promise<string> {
    if (
      embedOriginsCache &&
      Date.now() - embedOriginsCache.at < EMBED_ORIGINS_TTL_MS
    ) {
      return embedOriginsCache.value;
    }
    let origins: string[];
    try {
      const settings = await request.server.prisma.shopSettings.findUnique({
        where: { id: "default" },
        select: { embedAllowedOrigins: true },
      });
      origins = parseOriginList(settings?.embedAllowedOrigins);
    } catch (err) {
      request.log.warn(
        { err },
        "embedAllowedOrigins lookup failed — reusing last good value"
      );
      return embedOriginsCache?.value ?? "*";
    }
    const value = origins.length > 0 ? origins.join(" ") : "*";
    embedOriginsCache = { at: Date.now(), value };
    return value;
  }

  // ── Layer 1: Security Headers ──────────────────────────────────────────
  // Nonce-based CSP: generate a unique nonce per request and set the
  // Content-Security-Policy header manually so we can inject it into HTML.
  app.addHook("onRequest", async (request, reply) => {
    const nonce = generateNonce();
    request.cspNonce = nonce;

    // /embed/* pages exist to be iframed on the shop's own website — they get
    // a configurable frame-ancestors. Everything else stays clickjacking-proof.
    const isEmbed = isEmbedPath((request.raw.url ?? "").split("?", 1)[0]);
    const frameAncestors = isEmbed
      ? await embedFrameAncestors(request)
      : "'none'";
    const wsOrigins = IS_PROD ? "'self' wss:" : "'self' ws: wss:";
    const apiOrigin = env.API_URL ?? env.APP_URL ?? "";
    const requestHost = request.headers.host;
    const connectSrc = [wsOrigins];
    if (
      apiOrigin &&
      IS_PROD &&
      originMatchesRequestHost(apiOrigin, requestHost)
    ) {
      connectSrc.push(apiOrigin, apiOrigin.replace(HTTP_SCHEME_REPLACE, "ws"));
    }
    for (const origin of env.EXTRA_TRUSTED_ORIGINS) {
      if (
        !connectSrc.includes(origin) &&
        originMatchesRequestHost(origin, requestHost)
      ) {
        connectSrc.push(origin);
      }
    }
    reply.header(
      "Content-Security-Policy",
      [
        `default-src 'self'`,
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' data: blob:`,
        `font-src 'self' data:`,
        `connect-src ${connectSrc.join(" ")}`,
        // 'self' so the in-app print preview can frame /api/receipts/*; the
        // receipt route itself only allows same-origin framing (frame-ancestors).
        `frame-src 'self'`,
        `frame-ancestors ${frameAncestors}`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        ...(IS_HTTPS ? ["upgrade-insecure-requests"] : []),
      ].join(";")
    );
  });

  // XFO doesn't understand the /embed exception, so strip it there — CSP
  // frame-ancestors is the governing policy on modern browsers anyway.
  app.addHook("onSend", (request, reply, _payload, done) => {
    if (isEmbedPath((request.raw.url ?? "").split("?", 1)[0])) {
      reply.removeHeader("x-frame-options");
    }
    done();
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    // HSTS only makes sense (and must only be sent) over HTTPS. Plain-HTTP
    // LAN deployments without a TLS terminator must not receive the header.
    hsts: IS_HTTPS
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  });

  // ── Layer 2: CORS ───────────────────────────────────────────────────────
  const { trustedOrigins } = resolveUrls(env);
  const allowedOrigins = IS_PROD
    ? trustedOrigins
    : Array.from(
        new Set([
          ...trustedOrigins,
          "http://localhost:5173",
          "http://localhost:4000",
        ])
      );

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86_400,
  });

  // ── Layer 5: Auto-apply route security from config map ──────────────────
  // IMPORTANT: registered BEFORE @fastify/rate-limit. The plugin reads
  // routeOptions.config.rateLimit in its own onRoute hook, and onRoute
  // hooks run in registration order — so this map merge must already have
  // happened or every override (e.g. /api/demo/login 20/15min) is ignored.
  app.addHook("onRoute", (routeOptions) => {
    const url = routeOptions.path;
    const method = routeOptions.method;
    const methodStr = Array.isArray(method) ? method[0] : method;

    const override = matchRoute(url, routeSecurity);

    // Apply CSRF protection on mutations unless explicitly disabled
    if (isMutation(methodStr) && override?.csrf !== false) {
      const existing = routeOptions.preHandler;
      const csrfFn = app.csrfProtection;
      if (Array.isArray(existing)) {
        if (!existing.includes(csrfFn)) {
          routeOptions.preHandler = [...existing, csrfFn];
        }
      } else if (existing) {
        routeOptions.preHandler = [existing, csrfFn];
      } else {
        routeOptions.preHandler = [csrfFn];
      }
    }

    // Route-declared config wins over the central map, merged key by key:
    // a route that pins its own rateLimit keeps it, while still inheriting
    // everything else (csrf, allowSensitiveKeys) from the map.
    routeOptions.config = mergeRouteConfig(
      routeOptions.config as Record<string, unknown> | undefined,
      override
    );

    // DEMO_MODE: writes get a tighter ceiling (60/min) — the public demo
    // shares one data set, so a single visitor scripting POSTs must not
    // churn it for everyone else. Stricter per-route limits still win.
    clampDemoMutationRateLimit(routeOptions.config, methodStr);
  });

  // ── Layer 3: Rate Limiting (global — all API routes rate-limited) ───────
  // hook: 'preHandler' so the request body is parsed by the time per-route
  // keyGenerators run (sign-in rate-limits key on body.email/body.username).
  // Static assets and the SPA shell are exempt (a page load fetches dozens
  // of chunks); backoff windows are capped at 15 min and every rejection is
  // a 429 with Retry-After — see server/lib/rate-limit.ts.
  await app.register(rateLimit, {
    global: true,
    hook: "preHandler",
    max:
      DEFAULT_SECURITY.rateLimit &&
      typeof DEFAULT_SECURITY.rateLimit === "object"
        ? (DEFAULT_SECURITY.rateLimit as { max: number }).max
        : 100,
    timeWindow:
      DEFAULT_SECURITY.rateLimit &&
      typeof DEFAULT_SECURITY.rateLimit === "object"
        ? (DEFAULT_SECURITY.rateLimit as { timeWindow: string }).timeWindow
        : "1 minute",
    // NOTE: keyed on IP, not user — this preHandler was registered before
    // the auth plugin sets request.user, so request.user is always null
    // here. IP keying is intended (single shop behind NAT shares the
    // budget) and sensitive endpoints carry their own per-identifier
    // limits + lockout. DEMO_MODE keys on CF-Connecting-IP instead: the
    // demo sits behind cloudflared, where every request arrives from the
    // tunnel IP — plain request.ip would give all visitors ONE shared
    // budget (and ban:5 would let a single script block everyone).
    keyGenerator: (request) =>
      isDemoMode() ? demoRateLimitKey(request) : request.ip,
    exponentialBackoff: true,
    ban: 5,
    store: CappedBackoffStore,
    allowList: (request) => isRateLimitExempt(request),
    errorResponseBuilder: buildRateLimitError,
  });

  // ── Layer 4: CSRF Protection ───────────────────────────────────────────
  // Cookie secret is required when cookies are signed.
  await app.register(cookie, {
    secret: env.COOKIE_SECRET ?? env.BETTER_AUTH_SECRET,
  });

  await app.register(csrf, {
    cookieOpts: {
      // HTTPS deployments (incl. the Android Capacitor WebView, which is
      // cross-site against the public origin) need SameSite=None; Secure.
      // Plain-HTTP LAN deployments use Lax so the cookie is actually stored.
      sameSite: IS_HTTPS ? "none" : "lax",
      httpOnly: true,
      path: "/",
      secure: IS_HTTPS,
      signed: IS_PROD,
    },
  });

  app.get("/api/csrf-token", async (_req, reply) => {
    const token = await reply.generateCsrf();
    return { token };
  });

  // ── Layer 6: Request Sanitization ───────────────────────────────────────
  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function sanitizeObject(
    obj: Record<string, unknown>,
    path: string,
    log: FastifyInstance["log"]
  ): void {
    for (const key of Object.keys(obj)) {
      if (SENSITIVE_KEYS.has(key)) {
        log.warn({ key, path }, "Sanitized sensitive key from request body");
        delete obj[key];
        continue;
      }
      if (isObject(obj[key])) {
        sanitizeObject(obj[key], `${path}.${key}`, log);
      } else if (Array.isArray(obj[key])) {
        for (const [i, item] of (obj[key] as unknown[]).entries()) {
          if (isObject(item)) {
            sanitizeObject(item, `${path}.${key}[${i}]`, log);
          }
        }
      }
    }
  }

  app.addHook("preHandler", (request, _reply, done) => {
    const allowSensitive =
      request.routeOptions?.config?.allowSensitiveKeys ?? false;
    if (isObject(request.body) && !allowSensitive) {
      request.log.debug(
        { url: request.url, allowSensitive },
        "Applying request body sanitization"
      );
      sanitizeObject(
        request.body as Record<string, unknown>,
        "body",
        request.log
      );
    }
    done();
  });

  // ── Layer 7: Global Error Handler ──────────────────────────────────────
  app.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    if (isAppError(error)) {
      const payload: Record<string, unknown> = {
        code: error.code,
        message: error.message,
      };
      if (error.details !== undefined) {
        payload.details = error.details;
      }
      reply.status(error.status).send(payload);
      return;
    }

    // Prisma constraint violations surface as localized conflicts instead
    // of a generic 500 — P2002 unique, P2003 foreign-key restrict.
    const prismaCode = (error as { code?: string }).code;
    if (prismaCode === "P2002" || prismaCode === "P2003") {
      reply.status(409).send({
        code: "CONFLICT",
        message: "errors.conflict",
      });
      return;
    }

    const fastifyErr = error as FastifyError;
    if (fastifyErr.validation) {
      reply.status(fastifyErr.statusCode ?? 400).send({
        code: "VALIDATION_ERROR",
        message: "errors.validation_error",
      });
      return;
    }

    const statusCode = fastifyErr.statusCode ?? 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      _request.log.error({ err: error }, "Unhandled server error");
    }

    const payload: Record<string, unknown> = {
      code: "INTERNAL_ERROR",
      message: IS_PROD
        ? "An unexpected error occurred"
        : (error.message ?? "Unknown error"),
    };

    if (!IS_PROD) {
      payload.stack = error.stack;
    }

    reply.status(statusCode).send(payload);
  });

  // ── Layer 8: Audit Logging (fire-and-forget off the hot path) ──────────
  app.addHook("onResponse", (request, reply, done) => {
    done();
    logAuditRequest(request, reply);
  });
};

// Denylist: noisy routes with no audit value (mark-as-read, dashboard
// polls, AI chat/sessions, feedback, anonymous public pages). Every other
// authenticated mutation is audited — GDPR erasures, fiscal documents,
// data-io import/export, stock and price changes, etc.
export const NOISY_ROUTES = [
  "/api/notifications",
  "/api/dashboard",
  "/api/ai",
  "/api/feedback",
  "/api/public",
];

// Bulk CSV exports exfiltrate personal/fiscal data in one click (RGPD), so
// they are audited even though they are GETs. Every other audited request
// must be a mutation.
const AUDITED_GET_PREFIXES = ["/api/export"];

// Segment-aware prefix match: "/api/users" matches "/api/users/123" but
// never a sibling like "/api/users-x".
export function matchesRoutePrefix(routeUrl: string, prefix: string): boolean {
  return routeUrl === prefix || routeUrl.startsWith(`${prefix}/`);
}

// Validation failures (400/404/409/422) carry no audit value. Auth failures
// (401/403) do — they are RBAC probing — and are recorded with their
// statusCode in metadata.
const SKIPPED_STATUS_CODES = new Set([400, 404, 409, 422]);

export interface AuditDecision {
  method: string;
  routeUrl: string;
  statusCode: number;
  userId: string | null | undefined;
}

export function shouldAuditRequest({
  method,
  routeUrl,
  userId,
  statusCode,
}: AuditDecision): boolean {
  if (!userId) {
    return false;
  }
  if (SKIPPED_STATUS_CODES.has(statusCode)) {
    return false;
  }
  const path = routeUrl.split("?", 1)[0] ?? routeUrl;
  if (NOISY_ROUTES.some((p) => matchesRoutePrefix(path, p))) {
    return false;
  }
  if (MUTATION_METHODS.has(method)) {
    return true;
  }
  return (
    method === "GET" &&
    AUDITED_GET_PREFIXES.some((p) => matchesRoutePrefix(path, p))
  );
}

export function logAuditRequest(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user?.id;
  if (!userId) {
    return;
  }
  const routeUrl = request.routeOptions?.url ?? request.url;
  if (
    !shouldAuditRequest({
      method: request.method,
      routeUrl,
      userId,
      statusCode: reply.statusCode,
    })
  ) {
    return;
  }

  const action = `${request.method} ${routeUrl}`;
  const statusCode = reply.statusCode;

  setImmediate(() => {
    request.server.prisma.auditLog
      .create({
        data: {
          userId,
          action: "API_MUTATION",
          toValue: action,
          jobId: null,
          metadata: { requestId: request.id, statusCode },
        },
      })
      .catch((err) => {
        request.log.error({ err }, "Failed to write audit log");
      });
  });
}

export default fp(securityPlugin, { name: "security-plugin" });

declare module "fastify" {
  interface FastifyInstance {
    resetEmbedOriginsCache: () => void;
  }
  interface FastifyRequest {
    cspNonce: string;
  }
  interface FastifyContextConfig {
    allowSensitiveKeys?: boolean;
  }
}
