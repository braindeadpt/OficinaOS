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

function fakePrisma(overrides: Partial<SettingsRow> = {}) {
  const row: SettingsRow = {
    cloudApiUrl: CLOUD_URL,
    cloudEntitlements: ["ponto"],
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudSyncedAt: new Date(),
    pontoExternalAutoApprove: true,
    pontoExternalPhotoRequired: false,
    pontoGeoLat: 38.7,
    pontoGeoLng: -9.1,
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
      findMany: vi.fn(async () => []),
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
  it("pushes the complete authoritative ponto config to the cloud", async () => {
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
      pinSyncVersion: 1,
      shopGeo: { lat: 38.7, lng: -9.1, radiusM: 100 },
      smsNumber: "+351210000000",
      staff: [],
      timezone: "Europe/Lisbon",
      waNumber: "+351912345678",
    });
  });

  it("staff envia a última entrada efetiva como manualEntryAt e ignora recusadas", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true }));
    const prisma = fakePrisma();
    prisma.user.findMany.mockResolvedValue([
      {
        externalWork: false,
        id: "u1",
        phoneE164: "+351911111111",
        pontoSmsAllowed: true,
      },
    ] as never);
    const validAt = new Date("2026-01-10T10:00:00.000Z");
    prisma.timeEntry.findMany.mockResolvedValue([
      {
        at: validAt,
        createdAt: new Date("2026-01-10T10:00:01.000Z"),
        proofs: {},
        transport: "WHATSAPP_META",
        userId: "u1",
        validations: [],
      },
      {
        at: new Date("2026-01-10T09:30:00.000Z"),
        createdAt: new Date("2026-01-10T09:30:01.000Z"),
        proofs: {},
        transport: "MANUAL",
        userId: "u1",
        validations: [
          {
            byUser: { name: "Dono", username: "dono" },
            decision: "RECUSADO",
          },
        ],
      },
      {
        at: validAt,
        createdAt: new Date("2026-01-10T09:00:01.000Z"),
        proofs: {},
        transport: "MANUAL",
        userId: "u1",
        validations: [],
      },
    ] as never);
    const app = buildApp(prisma);
    const res = await app.inject({ method: "PUT", url: "/api/ponto/config" });
    expect(res.statusCode).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).staff).toEqual([
      {
        externalWork: false,
        manualEntryAt: validAt.toISOString(),
        phone: "+351911111111",
        smsAllowed: true,
      },
    ]);
    expect(prisma.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ corrections: { none: {} } }),
      })
    );
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
  it("proxies the regeneration to the cloud with the shop token", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ ok: true, qrId: "ab".repeat(16) })
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, qrId: "ab".repeat(16) });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/regenerate-qr`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer shop-token-secret");
  });

  it("502 CLOUD_UNREACHABLE when the cloud does not answer", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net down"));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("CLOUD_UNREACHABLE");
  });

  it("402 CLOUD_MODULE_REQUIRED when the cloud rejects the entitlement", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ error: "nf" }, 402));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "POST",
      url: "/api/ponto/regenerate-qr",
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });

  it("400 CLOUD_NOT_PAIRED when the shop has no cloud token", async () => {
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

describe("ponto — sync após validação do painel", () => {
  function mockValidation(prisma: ReturnType<typeof fakePrisma>) {
    prisma.timeEntry.findUnique.mockResolvedValue({ id: "entry-1" } as never);
    prisma.timeEntryValidation.create.mockResolvedValue({
      at: new Date("2026-01-10T12:00:00.000Z"),
      byUser: { name: "Dono", username: "dono" },
      decision: "RECUSADO",
      id: "validation-1",
      note: null,
    } as never);
  }

  function mockPontoStaff(prisma: ReturnType<typeof fakePrisma>) {
    prisma.user.findMany.mockResolvedValue([
      {
        externalWork: false,
        id: "u1",
        phoneE164: "+351911111111",
        pontoSmsAllowed: true,
      },
    ] as never);
  }

  it("qualquer validação bem-sucedida dispara o push da config", async () => {
    fetchMock.mockImplementation(() => cloudJson({ ok: true }));
    const prisma = fakePrisma();
    mockValidation(prisma);
    mockPontoStaff(prisma);
    prisma.timeEntryValidation.create.mockResolvedValue({
      at: new Date("2026-01-10T12:00:00.000Z"),
      byUser: { name: "Dono", username: "dono" },
      decision: "APROVADO",
      id: "validation-1",
      note: null,
    } as never);
    const approvedEntryAt = new Date("2026-01-10T09:00:00.000Z");
    prisma.timeEntry.findMany.mockResolvedValue([
      {
        at: approvedEntryAt,
        createdAt: new Date("2026-01-10T09:00:01.000Z"),
        proofs: {},
        transport: "WHATSAPP_META",
        userId: "u1",
        validations: [
          {
            byUser: { name: "Dono", username: "dono" },
            decision: "APROVADO",
          },
        ],
      },
    ] as never);
    const app = buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      payload: { decision: "APROVADO" },
      url: "/api/ponto/entries/entry-1/validate",
    });

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/ponto/config`);
    expect(init.method).toBe("PUT");
    const staff = JSON.parse(init.body).staff[0];
    expect(staff.manualEntryAt).toBe(approvedEntryAt.toISOString());
    expect(staff).not.toHaveProperty("revokeEntryAt");
  });

  it("recusar uma ENTRADA envia revokeEntryAt e revokedBy no push", async () => {
    fetchMock.mockImplementation(() => cloudJson({ ok: true }));
    const prisma = fakePrisma();
    mockValidation(prisma);
    prisma.user.findMany.mockResolvedValue([
      {
        externalWork: false,
        id: "u1",
        phoneE164: "+351911111111",
        pontoSmsAllowed: true,
      },
      {
        externalWork: false,
        id: "u2",
        phoneE164: "+351922222222",
        pontoSmsAllowed: false,
      },
    ] as never);
    const proofRecordedAt = "2026-01-10T09:00:01.250Z";
    const fallbackRecordedAt = new Date("2026-01-10T09:05:02.000Z");
    prisma.timeEntry.findMany.mockResolvedValue([
      {
        at: new Date("2026-01-10T08:58:00.000Z"),
        createdAt: new Date("2026-01-10T09:00:02.000Z"),
        proofs: { entryRecordedAt: proofRecordedAt },
        transport: "WHATSAPP_META",
        userId: "u1",
        validations: [
          {
            byUser: { name: "Dono", username: "dono" },
            decision: "RECUSADO",
          },
        ],
      },
      {
        at: new Date("2026-01-10T09:04:00.000Z"),
        createdAt: fallbackRecordedAt,
        proofs: {},
        transport: "SMS",
        userId: "u2",
        validations: [
          {
            byUser: { name: "Dono", username: "dono" },
            decision: "RECUSADO",
          },
        ],
      },
    ] as never);
    const app = buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      payload: { decision: "RECUSADO", note: "foto inválida" },
      url: "/api/ponto/entries/entry-1/validate",
    });

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).staff).toEqual([
      {
        externalWork: false,
        manualEntryAt: null,
        phone: "+351911111111",
        revokeEntryAt: proofRecordedAt,
        revokedBy: "Dono",
        smsAllowed: true,
      },
      {
        externalWork: false,
        manualEntryAt: null,
        phone: "+351922222222",
        revokeEntryAt: fallbackRecordedAt.toISOString(),
        revokedBy: "Dono",
        smsAllowed: false,
      },
    ]);
  });

  it("Cloud em baixo não impede gravar a validação local", async () => {
    fetchMock.mockRejectedValue(new Error("net down"));
    const prisma = fakePrisma();
    mockValidation(prisma);
    mockPontoStaff(prisma);
    const app = buildApp(prisma);

    const res = await app.inject({
      method: "POST",
      payload: { decision: "RECUSADO" },
      url: "/api/ponto/entries/entry-1/validate",
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.timeEntryValidation.create).toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
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
