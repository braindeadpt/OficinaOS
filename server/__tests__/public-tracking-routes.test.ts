import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRoutes } from "../routes/jobs.js";
import { publicRoutes } from "../routes/public.js";

// Regression coverage for the public customer endpoints: they must NOT be
// caught by the jobs plugin's requirePermission hook — an anonymous customer
// has no session. A 401/403 here means public tracking is broken.
const mocks = vi.hoisted(() => ({
  lookupByCode: vi.fn(),
  respondToQuote: vi.fn(),
}));

vi.mock("../services/job.service.js", () => ({
  lookupByCode: mocks.lookupByCode,
  lookupByCodeAuth: vi.fn(),
}));

vi.mock("../services/job-quote.service.js", () => ({
  respondToQuote: mocks.respondToQuote,
  listQuotes: vi.fn(),
  createAndSendQuote: vi.fn(),
}));

function buildApp() {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply
        .status(error.status)
        .send({ code: error.code, message: error.message });
      return;
    }
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });

  (app.decorate as (name: string, value: unknown) => void)("prisma", {});
  (app.decorate as (name: string, value: unknown) => void)("auth", {
    api: { userHasPermission: vi.fn().mockResolvedValue({ success: true }) },
  });
  (app.decorate as (name: string, value: unknown) => void)(
    "wsBroadcast",
    vi.fn()
  );

  // Anonymous request: no session → request.user stays undefined, which is
  // exactly what the requirePermission hook sees from a real public client.
  app.register(jobRoutes, { prefix: "/api/jobs" });
  app.register(publicRoutes, { prefix: "/api/public" });
  return app;
}

describe("public tracking endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/jobs/lookup does not 401 for anonymous customers", async () => {
    mocks.lookupByCode.mockResolvedValue({ jobExists: false });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/lookup?code=ABC123&phone4=1234",
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("JOB_NOT_FOUND");
  });

  it("POST /api/public/quote-respond does not 401 for anonymous customers", async () => {
    mocks.respondToQuote.mockResolvedValue({ jobExists: false });
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/quote-respond",
      payload: {
        code: "ABC123",
        phone4: "1234",
        quoteId: "q-1",
        decision: "approve",
      },
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("JOB_NOT_FOUND");
  });

  it("still rejects anonymous access to protected job routes", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/by-code/ABC123",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("rejects malformed public payloads before touching services", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/quote-respond",
      payload: {
        code: "!!!bad!!!",
        phone4: "1234",
        quoteId: "q-1",
        decision: "approve",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.respondToQuote).not.toHaveBeenCalled();
  });
});
