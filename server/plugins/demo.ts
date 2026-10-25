import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { demoRequestPath, isDemoBlockedPath, isDemoMode } from "../lib/demo.js";

/**
 * DEMO_MODE guard: rejects every route on the blocklist with 403
 * DEMO_DISABLED before auth or the handler run. Registered globally — a
 * hidden button in the UI is never the enforcement point.
 *
 * The check runs on the DECODED path: concrete routes use the matched
 * pattern (the router already resolved %XX into it) and the /api/auth/*
 * wildcard falls back to decoding the raw URL, so /api/%75sers/x or
 * /api/au%74h/change-password cannot slip past the prefix blocklist.
 */
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
const demoPlugin: FastifyPluginAsync = async (app) => {
  if (!isDemoMode()) {
    return;
  }
  // biome-ignore lint/suspicious/useAwait: Fastify hook signature is async
  app.addHook("onRequest", async (request) => {
    const pathname = demoRequestPath(
      request.routeOptions?.url,
      request.raw.url ?? request.url
    );
    if (isDemoBlockedPath(request.method, pathname)) {
      throw new AppError("DEMO_DISABLED");
    }
  });
};

export default fp(demoPlugin, { name: "demo-plugin" });
