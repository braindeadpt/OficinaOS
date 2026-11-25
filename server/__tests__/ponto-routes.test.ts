import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { __resetTzCache } from "../middlewares/dashboard-scope.js";
import { pontoRoutes } from "../routes/ponto.js";

const CLOUD_URL = "https://cloud.test";

interface SettingsRow {
  cloudApiUrl: string | null;
  cloudEntitlements: unknown;
  cloudShopTokenEncrypted: string | null;
  cloudSyncedAt: Date | null;
  pontoExternalAutoApprove: boolean;
  pontoExternalPhotoRequired: boolean;
  pontoGeoLat: number | null;
  pontoGeoLng: number | null;
  pontoRadiusM: number;
  pontoSmsNumber: string | null;
  pontoWaNumber: string | null;
  timezone: string | null;
}

function fakePrisma(
  overrides: Partial<SettingsRow> = {},
  staffUsers: unknown[] = []
) {
  const row: SettingsRow = {
    cloudApiUrl: CLOUD_URL,
    cloudEntitlements: ["ponto"],
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudSyncedAt: new Date(),
    pontoExternalAutoApprove: true,
    pontoExternalPhotoRequired: false,
    pontoGeoLat: 38.72,
    pontoGeoLng: -9.14,
    pontoRadiusM: 100,
    pontoSmsNumber: "+351210000000",
    pontoWaNumber: "+351912345678",
    timezone: "Europe/Lisbon",
    ...overrides,
  };
  return {
    pontoPhoto: { findMany: vi.fn(async () => []) },
    shopSettings: {
      // dashboardScope lê o fuso da loja via findFirst (cache 60s).
      findFirst: vi.fn(async () => ({ timezone: "Europe/Lisbon" })),
      findUnique: vi.fn(async () => ({ ...row })),
    },
    timeEntry: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    timeEntryValidation: { create: vi.fn(async () => ({})) },
    user: {
      findMany: vi.fn(async () => staffUsers),
      findUnique: vi.fn(async () => null),
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
  __resetTzCache();
});

afterEach(() => {
  vi.clearAllMocks();
  __resetTzCache();
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
    // tz é o fuso efetivo da loja — a UI formata as horas nele.
    expect(res.json()).toEqual({ enabled: true, tz: "Europe/Lisbon" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports disabled when the entitlement is not cached", async () => {
    const app = buildApp(fakePrisma({ cloudEntitlements: ["portal"] }));
    const res = await app.inject({ method: "GET", url: "/api/ponto/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, tz: "Europe/Lisbon" });
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
  it("pushes the full config (numbers, geo, flags, timezone, staff) to the cloud", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/config`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      externalAutoApprove: true,
      photoRequired: false,
      shopGeo: { lat: 38.72, lng: -9.14, radiusM: 100 },
      smsNumber: "+351210000000",
      staff: [],
      timezone: "Europe/Lisbon",
      waNumber: "+351912345678",
    });
  });

  it("shopGeo segue null quando a geo não está configurada", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const app = buildApp(fakePrisma({ pontoGeoLat: null, pontoGeoLng: null }));
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).shopGeo).toBeNull();
  });

  it("staff inclui internos e externos com phoneE164 (a Cloud recusa telefones não registados)", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const staff = [
      {
        externalWork: false,
        phoneE164: "+351912345678",
        pontoSmsAllowed: true,
      },
      {
        externalWork: true,
        phoneE164: "+351967654321",
        pontoSmsAllowed: false,
      },
    ];
    const app = buildApp(fakePrisma({}, staff));
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).staff).toEqual([
      { externalWork: false, phone: "+351912345678", smsAllowed: true },
      { externalWork: true, phone: "+351967654321", smsAllowed: false },
    ]);
  });

  it("funcionários sem phoneE164 ficam fora da lista staff", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const staff = [
      { externalWork: false, phoneE164: null, pontoSmsAllowed: false },
    ];
    const app = buildApp(fakePrisma({}, staff));
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).staff).toEqual([]);
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

describe("ponto — POST /regenerate-qr", () => {
  it("chama a Cloud e devolve o qrId novo", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ ok: true, qrId: "ab12cd34ef56ab12cd34ef56ab12cd34" })
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      qrId: "ab12cd34ef56ab12cd34ef56ab12cd34",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/regenerate-qr`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer shop-token-secret");
  });

  it("502 CLOUD_UNREACHABLE quando a Cloud não responde", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net down"));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("CLOUD_UNREACHABLE");
  });

  it("402 CLOUD_MODULE_REQUIRED quando a Cloud recusa o entitlement", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ error: "nf" }, 402));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("falhas restantes mapeiam para CLOUD_REQUEST_FAILED", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ error: "boom" }, 500));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("CLOUD_REQUEST_FAILED");
  });

  it("400 CLOUD_NOT_PAIRED sem token cloud", async () => {
    const app = buildApp(
      fakePrisma({ cloudApiUrl: null, cloudShopTokenEncrypted: null })
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLOUD_NOT_PAIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ponto — gate de escrita sem módulo (WP0.5)", () => {
  const semModulo = { cloudEntitlements: ["portal"] };

  it("POST /entries devolve CLOUD_MODULE_REQUIRED sem o módulo", async () => {
    const app = buildApp(fakePrisma(semModulo));
    const res = await app.inject({
      method: "POST",
      payload: {
        at: "2026-01-10T09:00:00.000Z",
        type: "ENTRADA",
        userId: "u1",
      },
      url: "/api/ponto/entries",
    });
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("POST /entries/:id/validate devolve CLOUD_MODULE_REQUIRED sem o módulo", async () => {
    const app = buildApp(fakePrisma(semModulo));
    const res = await app.inject({
      method: "POST",
      payload: { decision: "APROVADO" },
      url: "/api/ponto/entries/entry-1/validate",
    });
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("com o módulo ativo a validação passa o gate (não é 402 de módulo)", async () => {
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      payload: { decision: "APROVADO" },
      url: "/api/ponto/entries/entry-1/validate",
    });
    // Passa o gate e morre mais à frente na entrada inexistente — nunca
    // por falta de módulo.
    expect(res.json().code).not.toBe("CLOUD_MODULE_REQUIRED");
    expect(res.statusCode).not.toBe(500);
  });

  it("as leituras NUNCA levam gate e respondem 200 — retenção legal de 5 anos", async () => {
    const app = buildApp(fakePrisma(semModulo));
    for (const url of [
      "/api/ponto/entries",
      "/api/ponto/pending",
      "/api/ponto/decided",
      "/api/ponto/now",
      "/api/ponto/hours?from=2026-01-05&to=2026-01-11",
      "/api/ponto/missing-exits?from=2026-01-05&to=2026-01-11",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
    }
  });
});
