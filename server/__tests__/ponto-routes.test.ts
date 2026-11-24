import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { pontoRoutes } from "../routes/ponto.js";

const CLOUD_URL = "https://cloud.test";

interface SettingsRow {
  cloudApiUrl: string | null;
  cloudEntitlements: unknown;
  cloudShopTokenEncrypted: string | null;
  cloudSyncedAt: Date | null;
  pontoSmsNumber: string | null;
  pontoWaNumber: string | null;
}

function fakePrisma(overrides: Partial<SettingsRow> = {}) {
  const row: SettingsRow = {
    cloudApiUrl: CLOUD_URL,
    cloudEntitlements: ["ponto"],
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudSyncedAt: new Date(),
    pontoSmsNumber: "+351210000000",
    pontoWaNumber: "+351912345678",
    ...overrides,
  };
  return {
    shopSettings: {
      findUnique: vi.fn(async () => ({ ...row })),
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
        details: error.details,
        message: error.message,
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
  app.register(pontoRoutes, { prefix: "/api/ponto" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ponto — GET /status", () => {
  it("401 without a session", async () => {
    const app = buildApp(fakePrisma(), null);
    const res = await app.inject({ method: "GET", url: "/api/ponto/status" });
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports enabled from the cached entitlements", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/ponto/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports disabled when the entitlement is not cached", async () => {
    const app = buildApp(fakePrisma({ cloudEntitlements: ["portal"] }));
    const res = await app.inject({ method: "GET", url: "/api/ponto/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });
});

describe("ponto — GET /config", () => {
  it("400 CLOUD_NOT_PAIRED when the shop has no cloud token", async () => {
    const app = buildApp(
      fakePrisma({ cloudApiUrl: null, cloudShopTokenEncrypted: null })
    );
    const res = await app.inject({ method: "GET", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLOUD_NOT_PAIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("402 CLOUD_MODULE_REQUIRED when the module is not cached", async () => {
    const app = buildApp(fakePrisma({ cloudEntitlements: ["portal"] }));
    const res = await app.inject({ method: "GET", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the cloud config through with the shop token", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ slug: "my-shop", waNumber: "+351912345678" })
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      slug: "my-shop",
      waNumber: "+351912345678",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/config`);
    expect(init.headers.authorization).toBe("Bearer shop-token-secret");
  });

  it("degrades to configured:false when the cloud 404s (not deployed yet)", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ error: "nf" }, 404));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });

  it("degrades to configured:false when the cloud is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net down"));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });
});

describe("ponto — PUT /config", () => {
  it("pushes the local wa/sms numbers to the cloud", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/config`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      smsNumber: "+351210000000",
      waNumber: "+351912345678",
    });
  });

  it("502 CLOUD_UNREACHABLE when the cloud does not answer", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net down"));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("CLOUD_UNREACHABLE");
  });

  it("402 CLOUD_MODULE_REQUIRED when the cloud rejects the entitlement", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ error: "nf" }, 402));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("maps other cloud failures to CLOUD_REQUEST_FAILED", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ error: "boom" }, 500));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("CLOUD_REQUEST_FAILED");
  });
});
