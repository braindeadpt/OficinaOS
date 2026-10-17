import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { dataIoRoutes } from "../routes/data-io.js";
import { partsRoutes } from "../routes/parts.js";
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

  it("accepts null to clear nullable fields on update", async () => {
    const update = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "s1",
      ...args.data,
    }));
    const app = buildApp(
      {
        supplier: {
          findUnique: vi.fn(async () => ({ id: "s1", email: "a@b.c" })),
          update,
        },
      },
      [{ plugin: suppliersRoutes, prefix: "/api/suppliers" }]
    );
    const res = await app.inject({
      method: "PATCH",
      url: "/api/suppliers/s1",
      payload: { email: null, phone: null },
    });
    expect(res.statusCode).toBe(200);
    expect(update.mock.calls[0]?.[0].data.email).toBeNull();
    expect(update.mock.calls[0]?.[0].data.phone).toBeNull();
  });

  it("returns supplier detail with linked parts and rmas", async () => {
    const findUnique = vi.fn(async () => ({
      id: "s1",
      name: "ACME",
      parts: [{ id: "p1", name: "Screen" }],
      rmas: [{ id: "r1", status: "OPEN" }],
    }));
    const app = buildApp({ supplier: { findUnique } }, [
      { plugin: suppliersRoutes, prefix: "/api/suppliers" },
    ]);
    const res = await app.inject({ method: "GET", url: "/api/suppliers/s1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.parts).toHaveLength(1);
    expect(res.json().data.rmas).toHaveLength(1);
  });

  it("returns 404 for a missing supplier detail", async () => {
    const app = buildApp(
      { supplier: { findUnique: vi.fn(async () => null) } },
      [{ plugin: suppliersRoutes, prefix: "/api/suppliers" }]
    );
    const res = await app.inject({ method: "GET", url: "/api/suppliers/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("parts ↔ supplier link", () => {
  it("creates a part with supplierId and it shows on the supplier detail", async () => {
    const create = vi.fn(async (a: { data: Record<string, unknown> }) => ({
      id: "p1",
      ...a.data,
    }));
    const supplierFindUnique = vi.fn(
      async (): Promise<Record<string, unknown> | null> => ({ id: "s1" })
    );
    const prisma = {
      supplier: { findUnique: supplierFindUnique },
      partsCatalog: { create },
      stockMovement: { create: vi.fn(async () => ({})) },
    };
    const app = buildApp(prisma, [
      { plugin: suppliersRoutes, prefix: "/api/suppliers" },
      { plugin: partsRoutes, prefix: "/api/parts" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/parts",
      payload: {
        name: "Screen",
        category: "SCREEN",
        defaultPrice: 10,
        supplierId: "s1",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(create.mock.calls[0]?.[0].data.supplierRef).toEqual({
      connect: { id: "s1" },
    });

    // The part then appears on GET /api/suppliers/:id via include.parts.
    supplierFindUnique.mockResolvedValue({
      id: "s1",
      name: "ACME",
      parts: [{ id: "p1", name: "Screen", supplierId: "s1" }],
      rmas: [],
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/suppliers/s1",
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.parts[0]).toMatchObject({
      id: "p1",
      supplierId: "s1",
    });
  });

  it("clears the link when supplierId is patched to null", async () => {
    const update = vi.fn(async (_a: { data: Record<string, unknown> }) => ({
      id: "p1",
      supplierId: null,
    }));
    const prisma = {
      partsCatalog: {
        findUnique: vi.fn(async () => ({ id: "p1", stockQuantity: 0 })),
        update,
      },
      stockMovement: { create: vi.fn() },
    };
    const app = buildApp(prisma, [
      { plugin: partsRoutes, prefix: "/api/parts" },
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/parts/p1",
      payload: { supplierId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(update.mock.calls[0]?.[0].data.supplierId).toBeNull();
  });

  it("404s when supplierId points at a missing supplier", async () => {
    const prisma = {
      supplier: { findUnique: vi.fn(async () => null) },
      partsCatalog: { create: vi.fn() },
      stockMovement: { create: vi.fn() },
    };
    const app = buildApp(prisma, [
      { plugin: partsRoutes, prefix: "/api/parts" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/parts",
      payload: {
        name: "Screen",
        category: "SCREEN",
        defaultPrice: 10,
        supplierId: "ghost",
      },
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
    const updateMany = vi.fn(
      async (_args: {
        data: { sentAt?: Date };
        where: { status?: string };
      }) => ({ count: 1 })
    );
    const prisma = {
      supplierRma: {
        findUnique: vi.fn(async () => ({ id: "r1", status: "OPEN" })),
        findUniqueOrThrow: vi.fn(async () => ({ id: "r1", status: "SENT" })),
        updateMany,
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
    expect(updateMany.mock.calls[0]?.[0].where.status).toBe("OPEN");
    expect(updateMany.mock.calls[0]?.[0].data.sentAt).toBeInstanceOf(Date);
  });

  it.each([
    ["OPEN", "RECEIVED"],
    ["SENT", "RESOLVED"],
    ["RECEIVED", "SENT"],
    ["SENT", "OPEN"],
  ])("rejects %s → %s with 409 INVALID_TRANSITION", async (from, to) => {
    const updateMany = vi.fn();
    const prisma = {
      supplierRma: {
        findUnique: vi.fn(async () => ({ id: "r1", status: from })),
        updateMany,
      },
    };
    const app = buildApp(prisma, [
      { plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" },
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/supplier-rmas/r1",
      payload: { status: to },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("409s when a concurrent transition wins the status claim", async () => {
    const prisma = {
      supplierRma: {
        findUnique: vi.fn(async () => ({ id: "r1", status: "OPEN" })),
        updateMany: vi.fn(async () => ({ count: 0 })),
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
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("allows RECEIVED → RESOLVED and stamps resolvedAt", async () => {
    const updateMany = vi.fn(
      async (_args: { data: { resolvedAt?: Date } }) => ({ count: 1 })
    );
    const prisma = {
      supplierRma: {
        findUnique: vi.fn(async () => ({ id: "r1", status: "RECEIVED" })),
        findUniqueOrThrow: vi.fn(async () => ({ id: "r1" })),
        updateMany,
      },
    };
    const app = buildApp(prisma, [
      { plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" },
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/supplier-rmas/r1",
      payload: { status: "RESOLVED" },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMany.mock.calls[0]?.[0].data.resolvedAt).toBeInstanceOf(Date);
  });

  it("reopens a terminal RMA to OPEN and clears sentAt/resolvedAt", async () => {
    const updateMany = vi.fn(
      async (_args: { data: { sentAt?: unknown; resolvedAt?: unknown } }) => ({
        count: 1,
      })
    );
    const prisma = {
      supplierRma: {
        findUnique: vi.fn(async () => ({
          id: "r1",
          status: "RESOLVED",
          sentAt: new Date(),
          resolvedAt: new Date(),
        })),
        findUniqueOrThrow: vi.fn(async () => ({ id: "r1" })),
        updateMany,
      },
    };
    const app = buildApp(prisma, [
      { plugin: supplierRmasRoutes, prefix: "/api/supplier-rmas" },
    ]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/supplier-rmas/r1",
      payload: { status: "OPEN" },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMany.mock.calls[0]?.[0].data.sentAt).toBeNull();
    expect(updateMany.mock.calls[0]?.[0].data.resolvedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Job referrals
// ---------------------------------------------------------------------------

describe("job referrals", () => {
  it("creates a referral and leaves a job note in one transaction", async () => {
    const jobNoteCreate = vi.fn(
      async (_args: { data: { content: string } }) => ({})
    );
    const tx = {
      jobReferral: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
          id: "ref1",
          ...args.data,
        })),
      },
      jobNote: { create: jobNoteCreate },
    };
    const $transaction = vi.fn(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)
    );
    const prisma = {
      job: { findUnique: vi.fn(async () => ({ id: "j1" })) },
      $transaction,
    };
    const app = buildApp(prisma, [{ plugin: referralsRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/j1/referrals",
      payload: { toShopName: "MicroLab", reason: "board-level" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.toShopName).toBe("MicroLab");
    expect($transaction).toHaveBeenCalledOnce();
    expect(tx.jobReferral.create).toHaveBeenCalledOnce();
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

  it.each([
    ["SENT", "COMPLETED"],
    ["ACCEPTED", "SENT"],
    ["COMPLETED", "ACCEPTED"],
    ["CANCELLED", "COMPLETED"],
  ])("rejects %s → %s with 409 INVALID_TRANSITION", async (from, to) => {
    const updateMany = vi.fn();
    const prisma = {
      jobReferral: {
        findUnique: vi.fn(async () => ({ id: "r1", status: from })),
        updateMany,
      },
    };
    const app = buildApp(prisma, [{ plugin: referralsRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/referrals/r1",
      payload: { status: to },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("409s when a concurrent transition wins the status claim", async () => {
    const prisma = {
      jobReferral: {
        findUnique: vi.fn(async () => ({ id: "r1", status: "SENT" })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const app = buildApp(prisma, [{ plugin: referralsRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/referrals/r1",
      payload: { status: "ACCEPTED" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("allows ACCEPTED → COMPLETED and stamps resolvedAt", async () => {
    const updateMany = vi.fn(
      async (_args: { data: { resolvedAt?: Date } }) => ({ count: 1 })
    );
    const prisma = {
      jobReferral: {
        findUnique: vi.fn(async () => ({ id: "r1", status: "ACCEPTED" })),
        findUniqueOrThrow: vi.fn(async () => ({ id: "r1" })),
        updateMany,
      },
    };
    const app = buildApp(prisma, [{ plugin: referralsRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/referrals/r1",
      payload: { status: "COMPLETED" },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMany.mock.calls[0]?.[0].data.resolvedAt).toBeInstanceOf(Date);
  });

  it("reopens a terminal referral to SENT and clears resolvedAt", async () => {
    const updateMany = vi.fn(
      async (_args: { data: { resolvedAt?: unknown } }) => ({ count: 1 })
    );
    const prisma = {
      jobReferral: {
        findUnique: vi.fn(async () => ({
          id: "r1",
          status: "CANCELLED",
          resolvedAt: new Date(),
        })),
        findUniqueOrThrow: vi.fn(async () => ({ id: "r1" })),
        updateMany,
      },
    };
    const app = buildApp(prisma, [{ plugin: referralsRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/referrals/r1",
      payload: { status: "SENT" },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMany.mock.calls[0]?.[0].data.resolvedAt).toBeNull();
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
      auditLog: {
        create: vi.fn(
          async (a: {
            data: { action: string; metadata?: Record<string, unknown> };
          }) => a.data
        ),
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
    // export is audited with entity + row count only
    const audit = prisma.auditLog.create.mock.calls[0]?.[0]?.data;
    expect(audit.action).toBe("DATA_EXPORTED");
    expect(audit?.metadata).toEqual({ entity: "parts", rows: 1 });
  });

  it("imports parts, updating existing by name", async () => {
    const update = vi.fn(
      async (_args: { data: Record<string, unknown> }) => ({})
    );
    const create = vi.fn(async (_args: { data: { category: string } }) => ({}));
    const tx = {
      partsCatalog: { update, create },
      stockMovement: {
        create: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
      },
      // SELECT ... FOR UPDATE (locked balance 3) vs UPDATE ... RETURNING
      // (absolute write to the file value 5).
      $queryRaw: vi.fn((query: TemplateStringsArray | string) => {
        const text = Array.isArray(query) ? query.join(" ") : String(query);
        return Promise.resolve(
          text.includes("FOR UPDATE")
            ? [{ stockQuantity: 3 }]
            : [{ stockQuantity: 5 }]
        );
      }),
    };
    const prisma = {
      partsCatalog: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "p1", stockQuantity: 3 }])
          .mockResolvedValueOnce([]),
        update,
        create,
      },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      auditLog: { create: vi.fn(async () => ({})) },
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
    // "weirdcat" is not a valid category — the row fails per-line validation
    expect(body.created).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].row).toBe(3);
    expect(body.errors[0].field).toBe("category");
    // stock delta 3 → 5 written as an ADJUSTMENT movement, never a silent set
    expect(tx.stockMovement.create.mock.calls[0]?.[0]?.data).toMatchObject({
      partId: "p1",
      type: "ADJUSTMENT",
      quantity: 2,
    });
  });

  it("rejects import payloads that fail the envelope schema", async () => {
    const app = buildApp({}, [{ plugin: dataIoRoutes, prefix: "/api" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: "not-an-array" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });
});
