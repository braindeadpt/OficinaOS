import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoicingRoutes } from "../routes/invoicing.js";
import { saleRoutes } from "../routes/sales.js";
import { settingsRoutes } from "../routes/settings.js";

const mocks = vi.hoisted(() => ({
  issueInvoiceForJob: vi.fn(),
  issueInvoiceForSale: vi.fn(),
}));

vi.mock("../services/invoicing.service.js", () => ({
  issueInvoiceForJob: mocks.issueInvoiceForJob,
  issueInvoiceForSale: mocks.issueInvoiceForSale,
}));

interface SettingsRow {
  cloudEntitlements: unknown;
  invoicingAccount: string | null;
  invoicingApiKeyEncrypted: string | null;
  invoicingEnabled: boolean;
  invoicingTaxName: string;
}

function fakePrisma(overrides: Partial<SettingsRow> = {}) {
  const row: SettingsRow = {
    cloudEntitlements: ["invoicing"],
    invoicingAccount: "loja-fix",
    invoicingApiKeyEncrypted: "v1:enc",
    invoicingEnabled: true,
    invoicingTaxName: "IVA23",
    ...overrides,
  };
  const upsert = vi.fn(
    ({ create, update }: { create: object; update: object }) =>
      Promise.resolve({ ...create, ...row, ...update })
  );
  return {
    row,
    upsert,
    prisma: {
      shopSettings: {
        findUnique: vi.fn(async () => ({ ...row })),
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        upsert,
      },
    },
  };
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
  app.register(invoicingRoutes, { prefix: "/api/invoicing" });
  app.register(saleRoutes, { prefix: "/api/sales" });
  app.register(settingsRoutes, { prefix: "/api/settings" });
  return app;
}

const ENCRYPTED_PREFIX = /^v1:/;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/invoicing/status", () => {
  it("401 without a session", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma, null);
    const res = await app.inject({
      method: "GET",
      url: "/api/invoicing/status",
    });
    expect(res.statusCode).toBe(401);
  });

  it("reports enabled only when module + config are all present", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/invoicing/status",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, module: true });
  });

  it("enabled=false when any piece is missing", async () => {
    for (const patch of [
      { invoicingEnabled: false },
      { invoicingAccount: null },
      { invoicingApiKeyEncrypted: null },
    ] as const) {
      const { prisma } = fakePrisma(patch);
      const app = buildApp(prisma);
      const res = await app.inject({
        method: "GET",
        url: "/api/invoicing/status",
      });
      expect(res.json().enabled).toBe(false);
      expect(res.json().module).toBe(true);
    }
  });

  it("never leaks the API key in the response", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/invoicing/status",
    });
    expect(JSON.stringify(res.json())).not.toContain("v1:enc");
  });
});

describe("POST /api/sales/:id/invoice", () => {
  it("401 without a session", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma, null);
    const res = await app.inject({
      method: "POST",
      url: "/api/sales/s1/invoice",
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.issueInvoiceForSale).not.toHaveBeenCalled();
  });

  it("201 with the issued document refs", async () => {
    mocks.issueInvoiceForSale.mockResolvedValueOnce({
      docId: "42",
      docType: "FS",
      number: "FS 2026/1",
      permalink: "https://ix/1",
    });
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/sales/s1/invoice",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().number).toBe("FS 2026/1");
    expect(mocks.issueInvoiceForSale).toHaveBeenCalledWith(
      expect.anything(),
      "s1",
      expect.anything()
    );
  });

  it("409 ALREADY_INVOICED propagates as an error", async () => {
    mocks.issueInvoiceForSale.mockRejectedValueOnce(
      new AppError("ALREADY_INVOICED")
    );
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/sales/s1/invoice",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_INVOICED");
  });
});

describe("PUT /api/settings/invoicing", () => {
  it("402 when enabling without the invoicing module", async () => {
    const { prisma, upsert } = fakePrisma({ cloudEntitlements: ["portal"] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/invoicing",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("CLOUD_MODULE_REQUIRED");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("encrypts the API key before persisting", async () => {
    const { prisma, upsert } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/invoicing",
      payload: {
        account: "loja-fix",
        apiKey: "plain-secret-key",
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const call = upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    const saved = call.update.invoicingApiKeyEncrypted as string;
    expect(saved).toMatch(ENCRYPTED_PREFIX);
    expect(saved).not.toContain("plain-secret-key");
  });

  it("GET /api/settings/invoicing exposes hasApiKey, never the secret", async () => {
    const { prisma } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/invoicing",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasApiKey).toBe(true);
    expect(body.account).toBe("loja-fix");
    expect(JSON.stringify(body)).not.toContain("v1:enc");
  });

  it("rejects invalid account names", async () => {
    const { prisma, upsert } = fakePrisma();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/invoicing",
      payload: { account: "not a valid!!" },
    });
    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
