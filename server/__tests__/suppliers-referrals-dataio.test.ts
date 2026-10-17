import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { dataIoRoutes } from "../routes/data-io.js";
import { referralsRoutes } from "../routes/referrals.js";
import { supplierRmasRoutes, suppliersRoutes } from "../routes/suppliers.js";

function buildApp(
  prisma: unknown,
  plugins: { plugin: unknown; prefix?: string }[],
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
  for (const { plugin, prefix } of plugins) {
    app.register(plugin as never, prefix ? { prefix } : {});
  }
  return app;
}

// ---------------------------------------------------------------------------
// Suppliers + supplier RMAs
// ---------------------------------------------------------------------------

describe("suppliers routes", () => {
  it("lists active suppliers by default", async () => {
    const findMany = vi.fn(async (_args: { where: { isActive?: boolean } }) => [
      { id: "s1", name: "ACME" },
    ]);
    const app = buildApp({ supplier: { findMany } }, [
      { plugin: suppliersRoutes, prefix: "/api/suppliers" },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/suppliers" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(findMany.mock.calls[0]?.[0].where.isActive).toBe(true);
  });

  it("includes inactive when asked", async () => {
    const findMany = vi.fn(
      async (_args: { where: { isActive?: boolean } }) => []
    );
    const app = buildApp({ supplier: { findMany } }, [
      { plugin: suppliersRoutes, prefix: "/api/suppliers" },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/suppliers?includeInactive=true",
    });
    expect(res.statusCode).toBe(200);
    expect(findMany.mock.calls[0]?.[0].where.isActive).toBeUndefined();
  });

  it("creates a supplier", async () => {
    const create = vi.fn(async (args) => ({ id: "s1", ...args.data }));
    const app = buildApp({ supplier: { create } }, [
      { plugin: suppliersRoutes, prefix: "/api/suppliers" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/suppliers",
      payload: { name: "ACME", email: "sales@acme.test" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe("ACME");
  });

  it("rejects invalid payloads", async () => {
    const app = buildApp({ supplier: {} }, [
      { plugin: suppliersRoutes, prefix: "/api/suppliers" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/suppliers",
      payload: { name: "", email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when updating a missing supplier", async () => {
    const app = buildApp(
      { supplier: { findUnique: vi.fn(async () => null) } },
      [{ plugin: suppliersRoutes, prefix: "/api/suppliers" }]
    );
    const res = await app.inject({
      method: "PATCH",
      url: "/api/suppliers/nope",
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("supplier RMAs", () => {
  it("links an RMA to the repair selected by its reference", async () => {
    const create = vi.fn(async (args) => ({ id: "r1", ...args.data }));
    const prisma = {
      supplier: { findUnique: vi.fn(async () => ({ id: "s1" })) },
      job: { findUnique: vi.fn(async () => ({ id: "j1", jobCode: "REP-1" })) },
      supplierRma: { create },
    };
    const app = buildApp(prisma, [
      { plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/supplier-rmas",
      payload: { supplierId: "s1", jobCode: "REP-1", description: "Screen" },
    });
    expect(res.statusCode).toBe(201);
    expect(create.mock.calls[0][0].data.jobId).toBe("j1");
    expect(create.mock.calls[0][0].data).not.toHaveProperty("jobCode");
    await app.close();
  });

  it("rejects an unknown repair reference instead of silently leaving it unlinked", async () => {
    const create = vi.fn();
    const app = buildApp(
      {
        supplier: { findUnique: vi.fn(async () => ({ id: "s1" })) },
        job: { findUnique: vi.fn(async () => null) },
        supplierRma: { create },
      },
      [{ plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" }]
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/supplier-rmas",
      payload: { supplierId: "s1", jobCode: "missing", description: "Screen" },
    });
    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });
  it("creates an RMA for an existing supplier", async () => {
    const prisma = {
      supplier: { findUnique: vi.fn(async () => ({ id: "s1" })) },
      partsCatalog: { findUnique: vi.fn() },
      supplierRma: {
        create: vi.fn(async (args) => ({ id: "r1", ...args.data })),
      },
    };
    const app = buildApp(prisma, [
      { plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/supplier-rmas",
      payload: {
        supplierId: "s1",
        description: "Faulty screen",
        quantity: 2,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.supplierRma.create.mock.calls[0][0].data.createdById).toBe(
      "u1"
    );
  });

  it("404s when the supplier does not exist", async () => {
    const app = buildApp(
      { supplier: { findUnique: vi.fn(async () => null) } },
      [{ plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" }]
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/supplier-rmas",
      payload: { supplierId: "nope", description: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("stamps sentAt when status becomes SENT", async () => {
    const update = vi.fn(async (_args: { data: { sentAt?: Date } }) => ({
      id: "r1",
    }));
    const prisma = {
      supplierRma: {
        findUnique: vi.fn(async () => ({ id: "r1", status: "OPEN" })),
        update,
      },
    };
    const app = buildApp(prisma, [
      { plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" },
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/supplier-rmas/r1",
      payload: { status: "SENT" },
    });
    expect(res.statusCode).toBe(200);
    expect(update.mock.calls[0]?.[0].data.sentAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Job referrals
// ---------------------------------------------------------------------------

describe("job referrals", () => {
  it("creates a referral and leaves a job note", async () => {
    const jobNoteCreate = vi.fn(
      async (_args: { data: { content: string } }) => ({})
    );
    const prisma = {
      job: { findUnique: vi.fn(async () => ({ id: "j1" })) },
      jobReferral: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
          id: "ref1",
          ...args.data,
        })),
      },
      jobNote: { create: jobNoteCreate },
    };
    const app = buildApp(prisma, [{ plugin: referralsRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/j1/referrals",
      payload: { toShopName: "MicroLab", reason: "board-level" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.toShopName).toBe("MicroLab");
    expect(jobNoteCreate.mock.calls[0]?.[0].data.content).toContain("MicroLab");
  });

  it("404s when the job does not exist", async () => {
    const app = buildApp({ job: { findUnique: vi.fn(async () => null) } }, [
      { plugin: referralsRoutes, prefix: "/api" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/nope/referrals",
      payload: { toShopName: "X" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists referrals for a job", async () => {
    const app = buildApp(
      {
        jobReferral: {
          findMany: vi.fn(async () => [{ id: "r1", toShopName: "MicroLab" }]),
        },
      },
      [{ plugin: referralsRoutes, prefix: "/api" }]
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/j1/referrals",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Data import/export
// ---------------------------------------------------------------------------

describe("data-io routes", () => {
  it("exports parts as CSV with headers", async () => {
    const prisma = {
      partsCatalog: {
        findMany: vi.fn(async () => [
          {
            name: 'Screen "OLED"',
            category: "SCREEN",
            defaultPrice: { toString: () => "89.90" },
            stockQuantity: 5,
            reorderLevel: 2,
            supplier: "ACME",
            isActive: true,
          },
        ]),
      },
    };
    const app = buildApp(prisma, [{ plugin: dataIoRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "GET",
      url: "/api/export/parts.csv",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const body = res.body;
    expect(body).toContain("name;category;price");
    // quote escaping: embedded double-quotes double up
    expect(body).toContain('"Screen ""OLED"""');
  });

  it("imports parts, updating existing by name", async () => {
    const update = vi.fn(
      async (_args: { data: Record<string, unknown> }) => ({})
    );
    const create = vi.fn(async (_args: { data: { category: string } }) => ({}));
    const prisma = {
      partsCatalog: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: "p1" })
          .mockResolvedValueOnce(null),
        update,
        create,
      },
    };
    const app = buildApp(prisma, [{ plugin: dataIoRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: {
        rows: [
          { name: "Screen", price: 89.9, stock: 5, category: "SCREEN" },
          { name: "Battery", category: "weirdcat" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(1);
    expect(body.created).toBe(1);
    // unknown category falls back to OTHER
    expect(create.mock.calls[0]?.[0].data.category).toBe("OTHER");
  });

  it("rejects import payloads that fail schema", async () => {
    const app = buildApp({}, [{ plugin: dataIoRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });
});
