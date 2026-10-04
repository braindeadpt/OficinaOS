import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { intakeRequestsRoutes } from "../routes/intake-requests.js";
import { jobRoutes } from "../routes/jobs.js";
import { publicRoutes } from "../routes/public.js";

// Regression coverage for the public customer endpoints: they must NOT be
// caught by the jobs plugin's requirePermission hook — an anonymous customer
// has no session. A 401/403 here means public tracking is broken.
const mocks = vi.hoisted(() => ({
  convertIntakeRequest: vi.fn(),
  dismissIntakeRequest: vi.fn(),
  listIntakeRequests: vi.fn(),
  lookupByCode: vi.fn(),
  lookupReceiptByCode: vi.fn(),
  renderReceiptHtml: vi.fn(),
  respondToQuote: vi.fn(),
  submitPreCheckRequest: vi.fn(),
}));

vi.mock("../services/job.service.js", () => ({
  lookupByCode: mocks.lookupByCode,
  lookupByCodeAuth: vi.fn(),
  lookupReceiptByCode: mocks.lookupReceiptByCode,
}));

vi.mock("../services/receipt.service.js", () => ({
  renderReceiptHtml: mocks.renderReceiptHtml,
}));

vi.mock("../services/job-quote.service.js", () => ({
  respondToQuote: mocks.respondToQuote,
  listQuotes: vi.fn(),
  createAndSendQuote: vi.fn(),
}));

vi.mock("../services/intake-request.service.js", () => ({
  submitPreCheckRequest: mocks.submitPreCheckRequest,
  listIntakeRequests: mocks.listIntakeRequests,
  dismissIntakeRequest: mocks.dismissIntakeRequest,
  convertIntakeRequest: mocks.convertIntakeRequest,
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
  app.register(intakeRequestsRoutes, { prefix: "/api/intake-requests" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public tracking endpoints", () => {
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

  it("GET /api/jobs/lookup-receipt serves receipt HTML for valid code + phone4", async () => {
    mocks.lookupReceiptByCode.mockResolvedValue({
      job: { id: "j1", jobCode: "ABC123" },
      jobExists: true,
    });
    mocks.renderReceiptHtml.mockResolvedValue("<html>receipt</html>");
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/lookup-receipt?code=ABC123&phone4=1234",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toBe("<html>receipt</html>");
  });

  it("GET /api/jobs/lookup-receipt does not 401 and 404s on wrong phone4", async () => {
    mocks.lookupReceiptByCode.mockResolvedValue({
      job: null,
      jobExists: true,
    });
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/lookup-receipt?code=ABC123&phone4=9999",
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(404);
    expect(mocks.renderReceiptHtml).not.toHaveBeenCalled();
  });

  it("GET /api/jobs/lookup-receipt rejects malformed params before services", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/lookup-receipt?code=ABC123&phone4=abc",
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.lookupReceiptByCode).not.toHaveBeenCalled();
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

describe("public pre-check endpoint", () => {
  const VALID = {
    customerName: "Maria Silva",
    customerPhone: "912345678",
    deviceLabel: "iPhone 14",
    problem: "Screen cracked after a fall.",
  };

  it("POST /api/public/pre-check accepts a valid anonymous submission", async () => {
    mocks.submitPreCheckRequest.mockResolvedValue({
      code: "PRE-2026-000001",
      id: "req-1",
    });
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: VALID,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe("PRE-2026-000001");
    expect(mocks.submitPreCheckRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerName: "Maria Silva" }),
      expect.anything()
    );
  });

  it("accepts a valid scheduledFor in the future", async () => {
    mocks.submitPreCheckRequest.mockResolvedValue({
      code: "PRE-2026-000001",
      id: "req-1",
    });
    const app = buildApp();
    const scheduledFor = new Date(Date.now() + 3 * 86_400_000).toISOString();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: { ...VALID, scheduledFor },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.submitPreCheckRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scheduledFor }),
      expect.anything()
    );
  });

  it("rejects a scheduledFor in the past", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: {
        ...VALID,
        scheduledFor: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.submitPreCheckRequest).not.toHaveBeenCalled();
  });

  it("rejects a scheduledFor beyond 30 days", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: {
        ...VALID,
        scheduledFor: new Date(Date.now() + 31 * 86_400_000).toISOString(),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.submitPreCheckRequest).not.toHaveBeenCalled();
  });

  it("rejects missing required fields before touching the service", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: { customerName: "Maria" },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.submitPreCheckRequest).not.toHaveBeenCalled();
  });

  it("rejects too-short problem descriptions", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: { ...VALID, problem: "broken" },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.submitPreCheckRequest).not.toHaveBeenCalled();
  });

  it("fakes success for a filled honeypot without creating anything", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/public/pre-check",
      payload: { ...VALID, company: "spammy-bot" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
    expect(mocks.submitPreCheckRequest).not.toHaveBeenCalled();
  });
});

describe("staff intake-request routes", () => {
  it("GET /api/intake-requests rejects anonymous callers", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/intake-requests",
    });

    expect(res.statusCode).toBe(401);
    expect(mocks.listIntakeRequests).not.toHaveBeenCalled();
  });

  it("POST /api/intake-requests/:id/dismiss rejects anonymous callers", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/intake-requests/req-1/dismiss",
    });

    expect(res.statusCode).toBe(401);
    expect(mocks.dismissIntakeRequest).not.toHaveBeenCalled();
  });

  it("POST /api/intake-requests/:id/convert rejects anonymous callers", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/intake-requests/req-1/convert",
      payload: { jobId: "job-1" },
    });

    expect(res.statusCode).toBe(401);
    expect(mocks.convertIntakeRequest).not.toHaveBeenCalled();
  });
});
