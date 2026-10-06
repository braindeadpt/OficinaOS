import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { marketPricesRoutes } from "../routes/market-prices.js";

const CLOUD_URL = "https://cloud.test";

interface SettingsRow {
  cloudApiUrl: string | null;
  cloudEntitlements: unknown;
  cloudShopTokenEncrypted: string | null;
  pricesDirty: boolean;
  sharePrices: boolean;
}

function fakePrisma(overrides: Partial<SettingsRow> = {}) {
  const row: SettingsRow = {
    cloudApiUrl: CLOUD_URL,
    cloudEntitlements: ["market-prices"],
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    pricesDirty: true,
    sharePrices: false,
    ...overrides,
  };
  return {
    repairCatalog: {
      findMany: vi.fn(async () => [
        { defaultPrice: 120, name: "Ecrã iPhone 12" },
      ]),
    },
    partsCatalog: {
      findMany: vi.fn(async () => []),
    },
    shopSettings: {
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(({ data }: { data: Partial<SettingsRow> }) => {
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      }),
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
  app.register(marketPricesRoutes, { prefix: "/api/market-prices" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("market-prices — gates", () => {
  it("401 without a session", async () => {
    const app = buildApp(fakePrisma(), null);
    const res = await app.inject({ method: "GET", url: "/api/market-prices" });
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 CLOUD_NOT_PAIRED when the shop has no cloud token", async () => {
    const app = buildApp(
      fakePrisma({ cloudApiUrl: null, cloudShopTokenEncrypted: null })
    );
    const res = await app.inject({ method: "GET", url: "/api/market-prices" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLOUD_NOT_PAIRED");
  });

  it("402 CLOUD_MODULE_REQUIRED when the module is not cached", async () => {
    const app = buildApp(fakePrisma({ cloudEntitlements: ["portal"] }));
    const res = await app.inject({ method: "GET", url: "/api/market-prices" });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("market-prices — GET stats", () => {
  it("forwards to the cloud and merges own catalog prices by normalized key", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({
        stats: [
          {
            avgCents: 11_500,
            category: "SCREEN",
            key: "ecra iphone 12",
            kind: "repair",
            maxCents: 14_000,
            medianCents: 11_500,
            minCents: 9000,
            name: "Ecrã iPhone 12",
            shopCount: 4,
            updatedAt: new Date().toISOString(),
          },
          {
            avgCents: 4000,
            category: null,
            key: "bateria samsung",
            kind: "part",
            maxCents: 5000,
            medianCents: 4000,
            minCents: 3000,
            name: "Bateria Samsung",
            shopCount: 3,
            updatedAt: new Date().toISOString(),
          },
        ],
      })
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/market-prices" });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/prices/stats`);
    expect(init.headers.authorization).toBe("Bearer shop-token-secret");

    const body = res.json();
    expect(body.sharing).toBe(false);
    // "Ecrã iPhone 12" own = 120€ = 12000c, matched via normalized key.
    expect(body.stats[0].ownPriceCents).toBe(12_000);
    // No local part named "Bateria Samsung" → null.
    expect(body.stats[1].ownPriceCents).toBeNull();
  });

  it("cloud 402 MODULE_NOT_ENTITLED becomes local CLOUD_MODULE_REQUIRED", async () => {
    fetchMock.mockReturnValueOnce(
      cloudJson({ error: { code: "MODULE_NOT_ENTITLED" } }, 402)
    );
    const app = buildApp(fakePrisma());
    const res = await app.inject({ method: "GET", url: "/api/market-prices" });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });
});

describe("market-prices — PUT sharing toggle", () => {
  it("enabling pushes the catalog snapshot to the cloud", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ contributed: 1, ok: true }));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "PUT",
      url: "/api/market-prices",
      payload: { sharePrices: true },
    });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/prices/contribute`);
    expect(init.method).toBe("POST");
    const items = JSON.parse(init.body).items;
    expect(items).toEqual([
      {
        category: undefined,
        kind: "repair",
        name: "Ecrã iPhone 12",
        priceCents: 12_000,
      },
    ]);
  });

  it("disabling withdraws the shop's contributions", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true, removed: 3 }));
    const app = buildApp(fakePrisma({ sharePrices: true }));
    const res = await app.inject({
      method: "PUT",
      url: "/api/market-prices",
      payload: { sharePrices: false },
    });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/prices/contribute`);
    expect(init.method).toBe("DELETE");
  });

  it("still returns 200 when the cloud is unreachable (poll retries)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("net down"));
    const app = buildApp(fakePrisma());
    const res = await app.inject({
      method: "PUT",
      url: "/api/market-prices",
      payload: { sharePrices: true },
    });
    expect(res.statusCode).toBe(200);
  });
});
