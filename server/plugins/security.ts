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
} from "fastify";
import fp from "fastify-plugin";
import { loadEnv, resolveUrls } from "../config/env.js";
import {
  DEFAULT_SECURITY,
  isMutation,
  MUTATION_METHODS,
  matchRoute,
  mergeRouteConfig,
  routeSecurity,
} from "../config/route-security.js";

const HTTP_SCHEME_REPLACE = /^http/;

const SENSITIVE_KEYS = new Set(["password", "role", "mustChangePassword"]);

function generateNonce(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

const securityPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const env = loadEnv();
  const IS_PROD = env.NODE_ENV === "production";
  // HTTPS on the public origin gates TLS-only headers and cookie flags.
  const IS_HTTPS = (env.APP_URL ?? "").startsWith("https://");

  // ── Layer 1: Security Headers ──────────────────────────────────────────
  // Nonce-based CSP: generate a unique nonce per request and set the
  // Content-Security-Policy header manually so we can inject it into HTML.
  app.addHook("onRequest", (request, reply, done) => {
    const nonce = generateNonce();
    request.cspNonce = nonce;

    const wsOrigins = IS_PROD ? "'self' wss:" : "'self' ws: wss:";
    const apiOrigin = env.API_URL ?? env.APP_URL ?? "";
    const connectSrc = [wsOrigins];
    if (apiOrigin && IS_PROD) {
      connectSrc.push(apiOrigin, apiOrigin.replace(HTTP_SCHEME_REPLACE, "ws"));
    }
    for (const origin of env.EXTRA_TRUSTED_ORIGINS) {
      if (!connectSrc.includes(origin)) {
        connectSrc.push(origin);
      }
    }
    reply.header(
      "Content-Security-Policy",
      [
        `default-src 'self'`,
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
        `img-src 'self' data: blob:`,
        `font-src 'self' https://fonts.gstatic.com`,
        `connect-src ${connectSrc.join(" ")}`,
        `frame-src 'none'`,
        `frame-ancestors 'none'`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        ...(IS_HTTPS ? ["upgrade-insecure-requests"] : []),
      ].join(";")
    );

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

  // ── Layer 3: Rate Limiting (global — all routes rate-limited by default) ──
  // hook: 'preHandler' so the request body is parsed by the time per-route
  // keyGenerators run (sign-in rate-limits key on body.email/body.username).
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
    keyGenerator: (request) => request.user?.id ?? request.ip,
    exponentialBackoff: true,
    ban: 5,
    allowList: ["/health"],
    errorResponseBuilder: (_request, context) => ({
      code: "RATE_LIMITED",
      message: "errors.rate_limited",
      details: { retryAfter: Math.ceil(context.ttl / 1000) },
    }),
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

  // ── Layer 5: Auto-apply route security from config map ──────────────────
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
    if (!MUTATION_METHODS.has(request.method)) {
      return;
    }
    const userId = request.user?.id;
    if (!userId) {
      return;
    }

    const action = `${request.method} ${request.routeOptions?.url ?? request.url}`;
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
  });
};

export default fp(securityPlugin, { name: "security-plugin" });

declare module "fastify" {
  interface FastifyRequest {
    cspNonce: string;
  }
  interface FastifyContextConfig {
    allowSensitiveKeys?: boolean;
  }
}
