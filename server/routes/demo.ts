import { AppError } from "@shared/errors/app-error.js";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsync } from "fastify";
import { DEMO_PASSWORD, DEMO_USERNAME, isDemoMode } from "../lib/demo.js";

/**
 * Public demo entry point. POST /api/demo/login opens a session for the
 * seeded demo user (shop OWNER) without any password exchange — the
 * visitor only clicks «Experimentar a demo».
 *
 * The sign-in goes through better-auth's own handler so cookie attributes
 * (Secure/SameSite per deployment) stay identical to a real sign-in.
 */
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const demoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/demo/status", async () => ({ demo: isDemoMode() }));

  app.post("/api/demo/login", async (request, reply) => {
    if (!isDemoMode()) {
      throw new AppError("NOT_FOUND");
    }
    const user = await app.prisma.user.findUnique({
      where: { username: DEMO_USERNAME },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new AppError("UNAUTHORIZED");
    }

    const url = new URL(
      "/api/auth/sign-in/username",
      `http://${request.headers.host}`
    );
    const headers = fromNodeHeaders(request.headers);
    headers.set("content-type", "application/json");
    const res = await app.auth.handler(
      new Request(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          username: DEMO_USERNAME,
          password: DEMO_PASSWORD,
        }),
      })
    );

    reply.status(res.status);
    for (const [key, value] of res.headers.entries()) {
      if (key.toLowerCase() !== "content-length") {
        reply.header(key, value);
      }
    }
    const body = await res.text();
    if (res.status !== 200) {
      request.log.warn({ status: res.status }, "Demo sign-in failed");
    }
    return reply.send(body);
  });
};
