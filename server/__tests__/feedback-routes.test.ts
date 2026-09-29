import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedbackRoutes } from "../routes/feedback.js";
import { __resetFeedbackLabelCache } from "../services/feedback.service.js";

const envState = {
  GITHUB_FEEDBACK_TOKEN: "test-token" as string | undefined,
  GITHUB_FEEDBACK_REPO: "braindeadpt/OficinaOS",
};

vi.mock("../config/env.js", () => ({
  loadEnv: () => envState,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function buildApp(user: { id: string; name: string; username: string } | null) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({
        code: error.code,
        message: error.message,
      });
    } else {
      reply.status(500).send({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  });
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(feedbackRoutes, { prefix: "/api/feedback" });
  return app;
}

const USER = { id: "u1", name: "Pedro", username: "pedro" };
const VALID_BODY = {
  description: "The receipt printed the wrong total",
  contact: "pedro@loja.pt",
  context: {
    url: "/jobs/123",
    userAgent: "test-agent",
    locale: "pt-PT",
    errors: ["[error] boom"],
  },
};

beforeEach(() => {
  envState.GITHUB_FEEDBACK_TOKEN = "test-token";
  __resetFeedbackLabelCache();
  vi.clearAllMocks();
  // Label creation (422 = exists), then the issue itself.
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 422 }))
    .mockResolvedValueOnce(
      Response.json({ number: 42, html_url: "https://github.com/x/i/42" })
    );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/feedback/report", () => {
  it("returns 401 without a session", async () => {
    const res = await buildApp(null).inject({
      method: "POST",
      url: "/api/feedback/report",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when description is missing", async () => {
    const res = await buildApp(USER).inject({
      method: "POST",
      url: "/api/feedback/report",
      payload: { contact: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when the GitHub token is not configured", async () => {
    envState.GITHUB_FEEDBACK_TOKEN = undefined;
    const res = await buildApp(USER).inject({
      method: "POST",
      url: "/api/feedback/report",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("FEEDBACK_NOT_CONFIGURED");
  });

  it("creates a GitHub issue and returns its number", async () => {
    const res = await buildApp(USER).inject({
      method: "POST",
      url: "/api/feedback/report",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      issueNumber: 42,
      issueUrl: "https://github.com/x/i/42",
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/braindeadpt/OficinaOS/issues"
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    const sent = JSON.parse(init.body as string);
    expect(sent.title).toBe(
      "[User report] The receipt printed the wrong total"
    );
    expect(sent.labels).toEqual(["bug", "user-report"]);
    expect(sent.body).toContain("The receipt printed the wrong total");
    expect(sent.body).toContain("pedro@loja.pt");
    expect(sent.body).toContain("/jobs/123");
    expect(sent.body).toContain("[error] boom");
    expect(sent.body).toContain("`pedro`");
  });

  it("returns 502 when GitHub rejects the issue", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 422 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const res = await buildApp(USER).inject({
      method: "POST",
      url: "/api/feedback/report",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("FEEDBACK_FAILED");
  });
});
