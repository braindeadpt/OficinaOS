import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { isDemoBlockedPath, isDemoMode } from "../lib/demo.js";

/**
 * DEMO_MODE guard: rejects every route on the blocklist with 403
 * DEMO_DISABLED before auth or the handler run. Registered globally — a
 * hidden button in the UI is never the enforcement point.
 */
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
const demoPlugin: FastifyPluginAsync = async (app) => {
  if (!isDemoMode()) {
    return;
  }
  // biome-ignore lint/suspicious/useAwait: Fastify hook signature is async
  app.addHook("onRequest", async (request) => {
    const pathname = (request.raw.url ?? "").split("?", 1)[0];
    if (isDemoBlockedPath(request.method, pathname)) {
      throw new AppError("DEMO_DISABLED");
    }
  });
};

export default fp(demoPlugin, { name: "demo-plugin" });
