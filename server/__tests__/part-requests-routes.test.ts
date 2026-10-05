import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { partRequestsRoutes } from "../routes/part-requests.js";

const CLOUD_URL = "https://cloud.test";

interface SettingsRow {
  cloudApiUrl: string | null;
  cloudEntitlements: unknown;
  cloudShopTokenEncrypted: string | null;
}

function fakePrisma(overrides: Partial<SettingsRow> = {}) {
  const row: SettingsRow = {
    cloudApiUrl: CLOUD_URL,
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudEntitlements: ["market"],
    ...overrides,
  };
  return {
    shopSettings: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
    },
  };
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function cloudJson(body: unknown, status = 200) {
  return Promise.resolve(Response.json(body, { status }));
}

function buildApp(
  prisma: unknown,
  user: { id: string; role: string } | null = { id: "u1", role: "OWNER" }
) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    } else {
      reply.status(500).send({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  });
  app.decorate("auth", {
    api: {
      userHasPermission: () => Promise.resolve({ error: null, success: true }),
    },
  } as never);
  app.decorate("prisma", prisma as never);
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(partRequestsRoutes, { prefix: "/api/part-requests" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("part-requests proxy — entitlement gate", () => {
  it("401 without a session", async () => {
    const app = buildApp(fakePrisma(), null);
    const res = await app.inject({ method: "GET", url: "/api/part-requests" });
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 CLOUD_NOT_PAIRED when the shop has no cloud token", async () => {
    const app = buildApp(
      fakePrisma({ cloudApiUrl: null, cloudShopTokenEncrypted: null })
    );
    const res = await app.inject({ method: "GET", url: "/api/part-requests" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLOUD_NOT_PAIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("402 CLOUD_MODULE_REQUIRED when the cached modules lack 'market'", async () => {
    const app = buildApp(fakePrisma({ cloudEntitlements: ["portal"] }));
    const res = await app.inject({ method: "GET", url: "/api/part-requests" });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("part-requests proxy — board", () => {
  it("GET ?scope=board forwards to the cloud board with the bearer token", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ requests: [{ id: "r1", title: "ecrã iPhone 12" }] })
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/part-requests" });
    expect(res.statusCode).toBe(200);
    expect(res.json().requests[0].id).toBe("r1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/part-requests?scope=board`);
    expect(init.headers.authorization).toBe("Bearer shop-token-secret");
  });

  it("GET ?scope=mine forwards scope=mine", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ requests: [] }));
    const app = buildApp(fakePrisma());
    await app.inject({
      method: "GET",
      url: "/api/part-requests?scope=mine",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${CLOUD_URL}/part-requests?scope=mine`
    );
  });
});

describe("part-requests proxy — create", () => {
  const VALID = {
    title: "ecrã iPhone 12 OLED",
    partType: "SCREEN",
    deviceBrand: "Apple",
    maxPriceCents: 4500,
  };

  it("POST creates a request on the cloud (201)", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ id: "r9" }, 201));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/part-requests",
      payload: VALID,
    });
    expect(res.statusCode).toBe(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/part-requests`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).title).toBe(VALID.title);
  });

  it("POST rejects a too-short title without calling the cloud", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/part-requests",
      payload: { title: "ab", partType: "SCREEN" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("part-requests proxy — replies & close", () => {
  it("POST /:id/replies forwards a reply (201)", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ id: "rep1" }, 201));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/part-requests/r1/replies",
      payload: { note: "tenho em stock", priceCents: 4000 },
    });
    expect(res.statusCode).toBe(201);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${CLOUD_URL}/part-requests/r1/replies`
    );
  });

  it("POST /:id/replies rejects an empty reply", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/part-requests/r1/replies",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET /:id/replies returns the responder contacts", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ replies: [{ id: "rep1", contact: "910000000" }] })
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "GET",
      url: "/api/part-requests/r1/replies",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().replies[0].contact).toBe("910000000");
  });

  it("POST /:id/close forwards the status", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/part-requests/r1/close",
      payload: { status: "FOUND" },
    });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/part-requests/r1/close`);
    expect(JSON.parse(init.body).status).toBe("FOUND");
  });
});

describe("part-requests proxy — cloud error mapping", () => {
  it("cloud 402 MODULE_NOT_ENTITLED becomes local CLOUD_MODULE_REQUIRED", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ error: { code: "MODULE_NOT_ENTITLED" } }, 402)
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/part-requests" });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("cloud 404 becomes PART_REQUEST_NOT_FOUND", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ error: { code: "NOT_FOUND" } }, 404)
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "GET",
      url: "/api/part-requests/nope/replies",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PART_REQUEST_NOT_FOUND");
  });

  it("cloud 429 becomes RATE_LIMITED", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ error: { code: "RATE_LIMITED" } }, 429)
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/part-requests" });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe("RATE_LIMITED");
  });
});
