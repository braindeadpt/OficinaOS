import { isAppError } from "@shared/errors/app-error.js";
import { roles } from "@shared/permissions";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { dataIoRoutes } from "../routes/data-io.js";

/**
 * The RBAC tests wire userHasPermission to the REAL role matrix
 * (shared/permissions.ts) — no stubbed "always succeed". FRONT_DESK and
 * TECHNICIAN must get 403 on every /export and /import route; only OWNER
 * has settings:edit.
 */
function buildApp(
  prisma: unknown,
  user: { id: string; role: string } | null = { id: "u1", role: "OWNER" },
  realPermissions = true
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
      userHasPermission: ({
        body,
      }: {
        body: { role: keyof typeof roles; permissions: unknown };
      }) => {
        if (!realPermissions) {
          return Promise.resolve({ success: true });
        }
        const role = roles[body.role];
        const result = role
          ? role.authorize(body.permissions as Record<string, string[]>)
          : { success: false };
        return Promise.resolve(result);
      },
    },
  } as never);
  app.decorate("prisma", prisma as never);
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    (req as { locale: string }).locale = "en";
    done();
  });
  app.register(dataIoRoutes, { prefix: "/api" });
  return app;
}

const ALL_ROUTES: ["GET" | "POST", string, Record<string, unknown>?][] = [
  ["GET", "/api/export/jobs.csv"],
  ["GET", "/api/export/parts.csv"],
  ["GET", "/api/export/repairs.csv"],
  ["POST", "/api/import/parts", { rows: [] }],
  ["POST", "/api/import/repairs", { rows: [] }],
  ["POST", "/api/import/jobs", { rows: [] }],
];

describe("data-io RBAC — settings:edit (OWNER only)", () => {
  it("FRONT_DESK gets 403 on every import/export route", async () => {
    const app = buildApp({}, { id: "u2", role: "FRONT_DESK" });
    for (const [method, url, payload] of ALL_ROUTES) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("TECHNICIAN gets 403 on every import/export route", async () => {
    const app = buildApp({}, { id: "u3", role: "TECHNICIAN" });
    for (const [method, url, payload] of ALL_ROUTES) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("unauthenticated requests get 401", async () => {
    const app = buildApp({}, null);
    const res = await app.inject({
      method: "GET",
      url: "/api/export/jobs.csv",
    });
    expect(res.statusCode).toBe(401);
  });

  it("OWNER can export and import", async () => {
    const prisma = {
      partsCatalog: { findMany: vi.fn(async () => []) },
      repairCatalog: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({})),
      },
      job: { findMany: vi.fn(async () => []) },
      auditLog: {
        create: vi.fn(async () => ({})),
        findMany: vi.fn(async (_a: { where: unknown }) => []),
      },
    };
    const app = buildApp(prisma, { id: "u1", role: "OWNER" });
    for (const [method, url] of [
      ["GET", "/api/export/jobs.csv"],
      ["GET", "/api/export/parts.csv"],
      ["GET", "/api/export/repairs.csv"],
    ] as ["GET" | "POST", string][]) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(200);
    }
    const imp = await app.inject({
      method: "POST",
      url: "/api/import/repairs",
      payload: { rows: [{ name: "Diagnóstico", price: 15 }] },
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().created).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("export hardening", () => {
  it("csvEscape prefixes formula-injection cells with '", async () => {
    const prisma = {
      partsCatalog: {
        findMany: vi.fn(async () => [
          {
            id: "p1",
            name: "=CMD()",
            category: "OTHER",
            defaultPrice: { toString: () => "1" },
            stockQuantity: 0,
            reorderLevel: 0,
            supplier: "+351911",
            isActive: true,
          },
          {
            id: "p2",
            name: "@SUM(1)",
            category: "OTHER",
            defaultPrice: { toString: () => "-5" },
            stockQuantity: 0,
            reorderLevel: 0,
            supplier: "\tDROP",
            isActive: true,
          },
        ]),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/export/parts.csv",
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split("\r\n");
    expect(lines[1]).toContain("'=CMD()");
    expect(lines[1]).toContain("'+351911");
    expect(lines[2]).toContain("'@SUM(1)");
    // numeric-looking cell content also escapes: "-5" -> "'-5"
    expect(lines[2]).toContain("'-5");
    expect(lines[2]).toContain("'\tDROP");
  });

  it("jobs export includes deliveredAt from the DELIVERED transition", async () => {
    const delivered = new Date("2026-01-10T15:30:00Z");
    const prisma = {
      job: {
        findMany: vi.fn(async () => [
          {
            id: "j1",
            jobCode: "2026-000001",
            createdAt: new Date("2026-01-02T10:00:00Z"),
            status: "DELIVERED",
            customer: { name: "A", phone: "9", email: null },
            device: { model: "11", brand: { name: "Apple" } },
            reportedProblem: "broken",
            estimatedCost: null,
          },
        ]),
      },
      auditLog: {
        create: vi.fn(async () => ({})),
        findMany: vi.fn(async (_a: { where: unknown }) => [
          { jobId: "j1", createdAt: delivered },
        ]),
      },
    };
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/export/jobs.csv",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("deliveredAt");
    expect(res.body).toContain(delivered.toISOString());
    // the audit lookup is scoped to the page's job ids
    const auditWhere = prisma.auditLog.findMany.mock.calls[0]?.[0]?.where as {
      jobId: { in: string[] };
      action: string;
      toValue: string;
    };
    expect(auditWhere.jobId.in).toEqual(["j1"]);
    expect(auditWhere.action).toBe("STATUS_CHANGED");
    expect(auditWhere.toValue).toBe("DELIVERED");
  });
});

// ---------------------------------------------------------------------------

describe("parts import", () => {
  function prismaWithParts(
    existing: unknown[],
    opts: {
      lockedStock?: number;
      updateMisses?: boolean;
      suppliers?: { id: string }[];
    } = {}
  ) {
    const tx = {
      partsCatalog: {
        update: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
        create: vi.fn(async () => ({ id: "p-new" })),
      },
      stockMovement: { create: vi.fn(async () => ({})) },
      // First raw call is SELECT ... FOR UPDATE (the real balance), the
      // second is UPDATE ... RETURNING (the absolute write).
      $queryRaw: vi.fn((query: TemplateStringsArray | string) => {
        const text = Array.isArray(query) ? query.join(" ") : String(query);
        if (text.includes("FOR UPDATE")) {
          return Promise.resolve([{ stockQuantity: opts.lockedStock ?? 10 }]);
        }
        return Promise.resolve(
          opts.updateMisses ? [] : [{ stockQuantity: 10 }]
        );
      }),
    };
    return {
      prisma: {
        partsCatalog: {
          findMany: vi.fn(async () => existing),
          update: tx.partsCatalog.update,
          create: tx.partsCatalog.create,
        },
        auditLog: { create: vi.fn(async () => ({})) },
        supplier: { findMany: vi.fn(async () => opts.suppliers ?? []) },
        $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      },
      tx,
    };
  }

  it("does not touch category when the column is absent", async () => {
    const { prisma, tx } = prismaWithParts([{ id: "p1", stockQuantity: 3 }]);
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", price: 10 }] },
    });
    expect(res.statusCode).toBe(200);
    const patch = tx.partsCatalog.update.mock.calls[0]?.[0].data;
    expect(patch).toEqual({ defaultPrice: 10 });
    expect(patch.category).toBeUndefined();
  });

  it("conflicts on duplicate catalogue names instead of a blind update", async () => {
    const { prisma, tx } = prismaWithParts([
      { id: "p1", stockQuantity: 0 },
      { id: "p2", stockQuantity: 0 },
    ]);
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", price: 10 }] },
    });
    const body = res.json();
    expect(body.updated).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].row).toBe(2);
    expect(body.errors[0].field).toBe("name");
    expect(tx.partsCatalog.update).not.toHaveBeenCalled();
  });

  it("a per-row validation error does not abort the batch", async () => {
    const { prisma } = prismaWithParts([]);
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: {
        rows: [
          { name: "", price: 1 },
          { name: "Battery" },
          { name: "Port", price: "abc" },
        ],
      },
    });
    const body = res.json();
    expect(body.created).toBe(1);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0].row).toBe(2);
    expect(body.errors[1].row).toBe(4);
    expect(body.errors[1].field).toBe("price");
  });

  it("a new part with stock>0 records an opening ADJUSTMENT", async () => {
    const { prisma, tx } = prismaWithParts([]);
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", stock: 7 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partId: "p-new",
        type: "ADJUSTMENT",
        quantity: 7,
        balanceAfter: 7,
        note: "import",
      }),
    });
  });

  it("a new part with no stock column writes no movement", async () => {
    const { prisma, tx } = prismaWithParts([]);
    const app = buildApp(prisma);
    await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen" }] },
    });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it("computes the delta from the locked balance, not the stale lookup", async () => {
    // findMany saw stock 5, but a sale landed before our write — the row is
    // locked at 3. Delta must be 10-3=+7 with balanceAfter=10 (absolute).
    const { prisma, tx } = prismaWithParts([{ id: "p1", stockQuantity: 5 }], {
      lockedStock: 3,
    });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", stock: 10 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balanceAfter: 10,
          quantity: 7,
          type: "ADJUSTMENT",
        }),
      })
    );
  });

  it("writes no movement when the locked balance already matches", async () => {
    const { prisma, tx } = prismaWithParts([{ id: "p1", stockQuantity: 10 }], {
      lockedStock: 10,
    });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", stock: 10 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(1);
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it("a failed absolute UPDATE is a row error, not a fake ledger entry", async () => {
    const { prisma, tx } = prismaWithParts([{ id: "p1", stockQuantity: 3 }], {
      lockedStock: 3,
      updateMisses: true,
    });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", stock: 10 }] },
    });
    const body = res.json();
    expect(body.updated).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it("audits the import with outcome counts, not raw row count", async () => {
    const { prisma } = prismaWithParts([]);
    const app = buildApp(prisma);
    await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: {
        rows: [{ name: "Screen" }, { name: "" }],
      },
    });
    const auditCalls = prisma.auditLog.create.mock.calls as unknown as [
      {
        data: { metadata: { created: number; entity: string; errors: number } };
      },
    ][];
    const meta = auditCalls[0][0].data.metadata;
    expect(meta).toMatchObject({ created: 1, entity: "parts", errors: 1 });
    expect(meta).not.toHaveProperty("rows");
  });

  it("links supplierId when the supplier name hits exactly one record", async () => {
    const { prisma, tx } = prismaWithParts([], { suppliers: [{ id: "s1" }] });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", supplier: " acme " }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(1);
    const calls = tx.partsCatalog.create.mock.calls as unknown as [
      { data: { supplier: string; supplierId: string | null } },
    ][];
    expect(calls[0][0].data.supplier).toBe(" acme ");
    expect(calls[0][0].data.supplierId).toBe("s1");
  });

  it("leaves supplierId null when the supplier name is ambiguous", async () => {
    const { prisma, tx } = prismaWithParts([], {
      suppliers: [{ id: "s1" }, { id: "s2" }],
    });
    const app = buildApp(prisma);
    await app.inject({
      method: "POST",
      url: "/api/import/parts",
      payload: { rows: [{ name: "Screen", supplier: "ACME" }] },
    });
    const calls = tx.partsCatalog.create.mock.calls as unknown as [
      { data: { supplierId: string | null } },
    ][];
    expect(calls[0][0].data.supplierId).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("jobs import", () => {
  function prismaForJobs(opts: { dupe?: { id: string } | null } = {}) {
    const tx = {
      customer: {
        create: vi.fn(async (a: { data: Record<string, unknown> }) => ({
          id: "c-new",
          ...a.data,
        })),
      },
      brand: {
        findFirst: vi.fn(async () => ({ id: "b1", name: "apple" })),
        create: vi.fn(async () => ({ id: "b-new" })),
      },
      device: {
        upsert: vi.fn(async () => ({ id: "d1", category: null })),
      },
      job: {
        create: vi.fn(async (a: { data: Record<string, unknown> }) => ({
          id: "j-new",
          ...a.data,
        })),
      },
      auditLog: {
        create: vi.fn(
          async (_a: { data: { action: string; toValue?: string } }) => ({})
        ),
      },
      // Two raw callers share $queryRaw: findByNormalizedPhone (customers,
      // empty → create) and generateJobCode (job_counters → next seq).
      $queryRaw: vi.fn((query: TemplateStringsArray | string) => {
        const text = Array.isArray(query) ? query.join(" ") : String(query);
        return Promise.resolve(
          text.includes("job_counters") ? [{ lastSeq: 1 }] : []
        );
      }),
    };
    const prisma = {
      job: {
        findUnique: vi.fn(async (a: { where: Record<string, string> }) =>
          a.where.jobCode === opts.dupe?.id ? opts.dupe : null
        ),
      },
      auditLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      customer: tx.customer,
      brand: tx.brand,
      device: tx.device,
    };
    return { prisma, tx };
  }

  it("skips a row whose jobCode already exists (reimport dedupe)", async () => {
    const { prisma } = prismaForJobs({ dupe: { id: "2026-000001" } });
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/jobs",
      payload: {
        rows: [
          {
            jobCode: "2026-000001",
            customerName: "A",
            customerPhone: "912345678",
            deviceModel: "11",
            problem: "broken",
          },
        ],
      },
    });
    const body = res.json();
    expect(body.skipped).toBe(1);
    expect(body.created).toBe(0);
    expect(prisma.job.findUnique).toHaveBeenCalledWith({
      where: { jobCode: "2026-000001" },
      select: { id: true },
    });
  });

  it("defaults imported history to DELIVERED and stamps audit entries", async () => {
    const { prisma, tx } = prismaForJobs();
    const app = buildApp(prisma);
    const res = await app.inject({
      method: "POST",
      url: "/api/import/jobs",
      payload: {
        rows: [
          {
            customerName: "A",
            customerPhone: "912345678",
            deviceModel: "11",
            problem: "broken",
            createdAt: "2025-12-01",
            deliveredAt: "2025-12-05",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(1);
    const job = tx.job.create.mock.calls[0]?.[0].data;
    expect(job.status).toBe("DELIVERED");
    expect(job.createdAt).toEqual(new Date("2025-12-01"));
    const actions = tx.auditLog.create.mock.calls.map((c) => c[0].data);
    expect(actions[0]?.action).toBe("JOB_CREATED");
    expect(actions[1]).toMatchObject({
      action: "STATUS_CHANGED",
      toValue: "DELIVERED",
      createdAt: new Date("2025-12-05"),
    });
  });
});
