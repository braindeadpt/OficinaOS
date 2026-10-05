import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../lib/crypto.js";
import { storefrontRoutes } from "../routes/storefront.js";

const CLOUD_URL = "https://cloud.test";

interface SettingsRow {
  cloudApiUrl: string | null;
  cloudEntitlements: unknown;
  cloudShopTokenEncrypted: string | null;
  storeDescription: string | null;
  storeDirty: boolean;
  storeEmail: string | null;
  storePublished: boolean;
  storeSlug: string | null;
}

function fakePrisma(overrides: Partial<SettingsRow> = {}) {
  const row: SettingsRow = {
    cloudApiUrl: CLOUD_URL,
    cloudShopTokenEncrypted: encryptSecret("shop-token-secret"),
    cloudEntitlements: ["storefront"],
    storeDescription: null,
    storeDirty: false,
    storeEmail: null,
    storePublished: false,
    storeSlug: null,
    ...overrides,
  };
  return {
    row,
    prisma: {
      shopSettings: {
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        update: vi.fn(({ data }: { data: Partial<SettingsRow> }) => {
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        }),
      },
      partsCatalog: {
        count: vi.fn(async () => 3),
        findMany: vi.fn(async () => []),
      },
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
  app.register(storefrontRoutes, { prefix: "/api/storefront" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("storefront routes — auth & entitlement gate", () => {
  it("GET 401 without a session", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma, null);
    const res = await app.inject({ method: "GET", url: "/api/storefront" });
    expect(res.statusCode).toBe(401);
  });

  it("PUT 401 without a session", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma, null);
    const res = await app.inject({
      method: "PUT",
      url: "/api/storefront",
      payload: { published: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PUT 400 CLOUD_NOT_PAIRED when the shop has no cloud token", async () => {
    const { prisma } = fakePrisma({
      cloudApiUrl: null,
      cloudShopTokenEncrypted: null,
    });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/storefront",
      payload: { published: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLOUD_NOT_PAIRED");
  });

  it("PUT 402 CLOUD_MODULE_REQUIRED without the storefront module", async () => {
    const { prisma } = fakePrisma({ cloudEntitlements: ["portal"] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/storefront",
      payload: { published: true },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
  });
});

describe("storefront routes — GET", () => {
  it("returns config, module flag and item count", async () => {
    const { prisma } = fakePrisma({
      storeSlug: "minha-loja",
      storePublished: true,
    });
    const app = buildApp(prisma);
    const res = await app.inject({ method: "GET", url: "/api/storefront" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.module).toBe(true);
    expect(body.paired).toBe(true);
    expect(body.itemCount).toBe(3);
    expect(body.slug).toBe("minha-loja");
    expect(body.url).toBe(`${CLOUD_URL}/loja/minha-loja`);
  });

  it("url is null when no slug is assigned yet", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({ method: "GET", url: "/api/storefront" });
    expect(res.json().url).toBeNull();
  });
});

describe("storefront routes — PUT", () => {
  it("rejects an invalid slug without touching settings", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/storefront",
      payload: { published: true, slug: "Loja Fixa!!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("saves config, marks dirty and pushes to the cloud", async () => {
    fetchMock.mockReturnValueOnce(cloudJson({ ok: true, slug: "minha-loja" }));
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/storefront",
      payload: {
        description: "Reparações em Braga",
        email: "loja@exemplo.com",
        published: true,
        slug: "minha-loja",
      },
    });
    expect(res.statusCode).toBe(200);

    // Cloud push went out with the shop bearer token.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD_URL}/storefront`);
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toBe("Bearer shop-token-secret");
    const body = JSON.parse(init.body as string);
    expect(body.published).toBe(true);
    expect(body.slug).toBe("minha-loja");

    // Response reflects the slug the cloud assigned and dirty was cleared.
    const out = res.json();
    expect(out.slug).toBe("minha-loja");
    expect(out.url).toBe(`${CLOUD_URL}/loja/minha-loja`);
    expect(out.dirty).toBe(false);
  });

  it("stays dirty when the push fails — poller retries later", async () => {
    fetchMock.mockRejectedValueOnce(new Error("cloud down"));
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/storefront",
      payload: { published: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dirty).toBe(true);
  });
});
