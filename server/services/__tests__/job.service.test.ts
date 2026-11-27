import { createHash } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants";
import { canonicalize } from "@shared/intake-document.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeFinalCost,
  computeMargin,
  create,
  getById,
  getMetrics,
  list,
  lookupByCode,
  transitionStatus,
  update,
} from "../job.service";

// Mock audit service to avoid side effects
vi.mock("../audit.service.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../notification-dispatch.js", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

function mockPrisma(
  overrides: Partial<Record<keyof PrismaClient, unknown>> = {}
) {
  const mock = {
    brand: {
      findFirst: vi.fn(),
      create: vi.fn(),
      ...((overrides as Record<string, unknown>).brand || {}),
    },
    job: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
      ...((overrides as Record<string, unknown>).job || {}),
    },
    jobCounter: {
      upsert: vi.fn(),
      ...((overrides as Record<string, unknown>).jobCounter || {}),
    },
    jobRepair: {
      createMany: vi.fn(),
      ...((overrides as Record<string, unknown>).jobRepair || {}),
    },
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      ...((overrides as Record<string, unknown>).customer || {}),
    },
    user: {
      findUnique: vi.fn(),
      ...((overrides as Record<string, unknown>).user || {}),
    },
    device: {
      upsert: vi.fn(),
      ...((overrides as Record<string, unknown>).device || {}),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      ...((overrides as Record<string, unknown>).auditLog || {}),
    },
    shopSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      ...((overrides as Record<string, unknown>).shopSettings || {}),
    },
    returnClaim: {
      findUnique: vi.fn(),
      ...((overrides as Record<string, unknown>).returnClaim || {}),
    },
    externalRepair: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...((overrides as Record<string, unknown>).externalRepair || {}),
    },
    payment: {
      create: vi.fn().mockResolvedValue({ id: "pay-1" }),
      ...((overrides as Record<string, unknown>).payment || {}),
    },
    $transaction: vi.fn((callback: (client: typeof mock) => Promise<unknown>) =>
      callback(mock)
    ),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "job-1" }]),
    ...overrides,
  };
  return mock as unknown as PrismaClient;
}

const mockNotifyCtx = { prisma: {} as PrismaClient, wsBroadcast: undefined };

describe("computeFinalCost", () => {
  it("sums repairs and parts costs", () => {
    const cost = computeFinalCost({
      partsUsed: [{ totalCost: { toNumber: () => 30 } }],
      repairs: [{ price: { toNumber: () => 10 } }],
    });
    expect(cost).toBe(40);
  });

  it("returns 0 when no parts or repairs", () => {
    const cost = computeFinalCost({
      partsUsed: [],
      repairs: [],
    });
    expect(cost).toBe(0);
  });

  it("sums only repairs when no parts", () => {
    const cost = computeFinalCost({
      partsUsed: [],
      repairs: [
        { price: { toNumber: () => 50 } },
        { price: { toNumber: () => 25 } },
      ],
    });
    expect(cost).toBe(75);
  });

  it("sums only parts when no repairs", () => {
    const cost = computeFinalCost({
      partsUsed: [
        { totalCost: { toNumber: () => 100 } },
        { totalCost: { toNumber: () => 50 } },
      ],
      repairs: [],
    });
    expect(cost).toBe(150);
  });
});

describe("computeMargin", () => {
  it("computes margin as finalCost minus parts cost", () => {
    const margin = computeMargin({
      finalCost: 5000,
      partsUsed: [{ totalCost: 2000 }, { totalCost: 1000 }],
    });
    expect(margin).toBe(2000);
  });

  it("returns negative margin when parts exceed finalCost", () => {
    const margin = computeMargin({
      finalCost: 2000,
      partsUsed: [{ totalCost: 3000 }],
    });
    expect(margin).toBe(-1000);
  });

  it("subtracts external repair costs from margin", () => {
    const margin = computeMargin({
      finalCost: 8000,
      partsUsed: [{ totalCost: 2000 }],
      externalRepairs: [
        { costFinal: 1500 },
        { costFinal: null },
        { costFinal: { toNumber: () => 500 } },
      ],
    });
    expect(margin).toBe(4000);
  });

  it("handles Decimal-like objects with toNumber", () => {
    const margin = computeMargin({
      finalCost: { toNumber: () => 8000 },
      partsUsed: [{ totalCost: { toNumber: () => 3000 } }],
    });
    expect(margin).toBe(5000);
  });

  it("returns full finalCost as margin when no parts", () => {
    const margin = computeMargin({
      finalCost: 5000,
      partsUsed: [],
    });
    expect(margin).toBe(5000);
  });
});

describe("lookupByCode", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns jobExists: false when job not found", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await lookupByCode(prisma, "ABC123", "1234");

    expect(result.jobExists).toBe(false);
    expect(result.job).toBeNull();
  });

  it("returns jobExists: true but no job when phone4 is wrong", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { phone: "+1-555-123-4567", name: "John" },
      device: { brand: { name: "Apple" }, model: "iPhone 14" },
      jobCode: "ABC123",
      notes: [],
      quotes: [],
      repairs: [],
      status: "IN_REPAIR",
    });

    const result = await lookupByCode(prisma, "ABC123", "9999");

    expect(result.jobExists).toBe(true);
    expect(result.job).toBeNull();
  });

  it("returns job when phone4 matches last 4 digits", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date("2024-01-01"),
      customer: { name: "John Doe", phone: "+1-555-123-4567" },
      device: { brand: { name: "Apple" }, model: "iPhone 14" },
      estimatedDate: null,
      jobCode: "ABC123",
      notes: [],
      quotes: [],
      repairs: [],
      reportedProblem: "Screen broken",
      status: "IN_REPAIR",
    });

    const result = await lookupByCode(prisma, "ABC123", "4567");

    expect(result.jobExists).toBe(true);
    expect(result.job).not.toBeNull();
    expect(result.job?.jobCode).toBe("ABC123");
    // Public tracking masks the name — first name + last initial only.
    expect(result.job?.customer).toEqual({ name: "John D." });
  });

  it("normalizes phone by stripping non-digits before comparison", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date("2024-01-01"),
      customer: { name: "Jane", phone: "(555) 123-9999" },
      device: { brand: { name: "Samsung" }, model: "Galaxy S23" },
      estimatedDate: null,
      jobCode: "DEF456",
      notes: [],
      quotes: [],
      repairs: [],
      reportedProblem: "Battery issue",
      status: "PENDING",
    });

    const result = await lookupByCode(prisma, "DEF456", "9999");

    expect(result.jobExists).toBe(true);
    expect(result.job).not.toBeNull();
  });

  it("returns jobExists: true but no job when stored phone is empty", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { name: "No Phone", phone: "" },
      device: { brand: { name: "Apple" }, model: "iPhone 13" },
      jobCode: "GHI789",
      notes: [],
      quotes: [],
      repairs: [],
      status: "COMPLETED",
    });

    const result = await lookupByCode(prisma, "GHI789", "1234");

    expect(result.jobExists).toBe(true);
    expect(result.job).toBeNull();
  });

  it("returns jobExists: true but no job when normalized phone has less than 4 digits", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { name: "Short", phone: "123" },
      device: { brand: { name: "Apple" }, model: "iPhone 13" },
      jobCode: "JKL012",
      notes: [],
      quotes: [],
      repairs: [],
      status: "COMPLETED",
    });

    const result = await lookupByCode(prisma, "JKL012", "123");

    expect(result.jobExists).toBe(true);
    expect(result.job).toBeNull();
  });
});

describe("lookupByCode — warranty & receipt", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  const baseJob = {
    createdAt: new Date("2024-01-01"),
    customer: { name: "John Doe", phone: "+1-555-123-4567" },
    depositAmount: null,
    device: { brand: { name: "Apple" }, model: "iPhone 14" },
    estimatedCost: { toNumber: () => 200 },
    estimatedDate: null,
    jobCode: "ABC123",
    notes: [],
    partsUsed: [
      {
        partName: "OLED Screen",
        quantity: 1,
        totalCost: { toNumber: () => 120 },
      },
    ],
    payments: [
      {
        amount: { toNumber: () => 50 },
        createdAt: new Date("2024-01-11"),
        method: "CARD",
      },
    ],
    quotes: [],
    repairs: [
      {
        price: { toNumber: () => 80 },
        repair: { warrantyDays: 90 },
        repairName: "Screen replacement",
      },
      {
        price: { toNumber: () => 30 },
        repair: null,
        repairName: "Cleaning",
      },
    ],
    reportedProblem: "Screen broken",
    status: "DELIVERED",
  };

  beforeEach(() => {
    prisma = mockPrisma({
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue({
          address: "Rua X",
          currency: "EUR",
          defaultWarrantyDays: 30,
          phone: "123",
          reviewUrl: "https://g.page/r/abc123/review",
          shopName: "Shop",
        }),
      },
    });
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        createdAt: new Date("2024-01-05"),
        fromValue: "IN_REPAIR",
        toValue: "DONE",
      },
      {
        createdAt: new Date("2024-01-10"),
        fromValue: "DONE",
        toValue: "DELIVERED",
      },
    ]);
  });

  it("returns per-repair warranty days from catalog, falling back to shop default", async () => {
    const result = await lookupByCode(prisma, "ABC123", "4567");
    const warranty = result.job?.warranty as {
      items: { days: number; name: string }[];
    };

    expect(warranty.items).toEqual([
      { days: 90, name: "Screen replacement", validUntil: expect.anything() },
      { days: 30, name: "Cleaning", validUntil: expect.anything() },
    ]);
  });

  it("computes validUntil from the DELIVERED transition date", async () => {
    const result = await lookupByCode(prisma, "ABC123", "4567");
    const warranty = result.job?.warranty as {
      deliveredAt: string;
      items: { name: string; validUntil: string }[];
    };

    expect(new Date(warranty.deliveredAt).toISOString()).toBe(
      new Date("2024-01-10").toISOString()
    );
    const screen = warranty.items.find((i) => i.name === "Screen replacement");
    expect(
      screen?.validUntil && new Date(screen.validUntil).toISOString()
    ).toBe(
      new Date(new Date("2024-01-10").getTime() + 90 * 86_400_000).toISOString()
    );
  });

  it("returns null validUntil when the job was never delivered", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      status: "IN_REPAIR",
    });
    (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );

    const result = await lookupByCode(prisma, "ABC123", "4567");
    const warranty = result.job?.warranty as {
      deliveredAt: string | null;
      items: { validUntil: string | null }[];
    };

    expect(warranty.deliveredAt).toBeNull();
    expect(warranty.items.every((i) => i.validUntil === null)).toBe(true);
  });

  it("returns receipt totals: items, payments, deposit, paid and balance due", async () => {
    const result = await lookupByCode(prisma, "ABC123", "4567");
    const receipt = result.job?.receipt as {
      balanceDue: number;
      currency: string;
      deposit: number;
      items: { name: string; price: number; quantity: number }[];
      paid: number;
      payments: { amount: number; createdAt: Date; method: string }[];
      total: number;
    };

    expect(receipt.total).toBe(230); // 80 + 30 repairs + 120 part
    expect(receipt.paid).toBe(50);
    expect(receipt.balanceDue).toBe(180);
    expect(receipt.currency).toBe("EUR");
    expect(receipt.payments).toEqual([
      {
        amount: 50,
        createdAt: new Date("2024-01-11"),
        method: "CARD",
      },
    ]);
    expect(receipt.items).toContainEqual({
      name: "Screen replacement",
      price: 80,
      quantity: 1,
    });
    expect(receipt.items).toContainEqual({
      name: "OLED Screen",
      price: 120,
      quantity: 1,
    });
  });

  it("counts the deposit as paid and falls back to estimatedCost when nothing is itemized", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      depositAmount: { toNumber: () => 20 },
      partsUsed: [],
      payments: [],
      repairs: [],
    });

    const result = await lookupByCode(prisma, "ABC123", "4567");
    const receipt = result.job?.receipt as {
      balanceDue: number;
      paid: number;
      total: number;
    };

    expect(receipt.total).toBe(200);
    expect(receipt.paid).toBe(20);
    expect(receipt.balanceDue).toBe(180);
  });

  it("exposes the shop reviewUrl so delivered customers can leave a review", async () => {
    const result = await lookupByCode(prisma, "ABC123", "4567");
    const shop = result.job?.shop as { reviewUrl: string | null };

    expect(shop.reviewUrl).toBe("https://g.page/r/abc123/review");
  });
});

describe("list", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns jobs with pagination info", async () => {
    const mockJobs = [
      {
        id: "1",
        customer: { name: "Alice" },
        device: { brand: { name: "Apple" } },
        technician: null,
      },
      {
        id: "2",
        customer: { name: "Bob" },
        device: { brand: { name: "Samsung" } },
        technician: null,
      },
    ];
    (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJobs
    );
    (prisma.job.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: undefined,
      status: undefined,
      technicianId: undefined,
    });

    expect(result.jobs).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by status", async () => {
    (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.job.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: undefined,
      status: "IN_REPAIR",
      technicianId: undefined,
    });

    const findManyCall = (prisma.job.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(findManyCall[0].where.status).toBe("IN_REPAIR");
  });

  it("filters by technicianId", async () => {
    (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.job.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: undefined,
      status: undefined,
      technicianId: "tech-1",
    });

    const findManyCall = (prisma.job.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(findManyCall[0].where.technicianId).toBe("tech-1");
  });

  it("searches across job code, customer name, and device info", async () => {
    (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.job.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: "iPhone",
      status: undefined,
      technicianId: undefined,
    });

    const findManyCall = (prisma.job.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(findManyCall[0].where.OR).toBeDefined();
    expect(findManyCall[0].where.OR).toHaveLength(5);
  });

  it("sets nextCursor when more results exist", async () => {
    const mockJobs = new Array(11).fill(null).map((_, i) => ({
      customer: { name: `User ${i}` },
      device: { brand: { name: "Apple" } },
      id: String(i + 1),
      technician: null,
    }));
    (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      ...mockJobs,
    ]);
    (prisma.job.count as ReturnType<typeof vi.fn>).mockResolvedValue(11);

    const result = await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: undefined,
      status: undefined,
      technicianId: undefined,
    });

    expect(result.jobs).toHaveLength(10);
    expect(result.nextCursor).toBe("11");
  });

  it("does not count when cursor is provided", async () => {
    (prisma.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await list(prisma, {
      cursor: "some-cursor",
      limit: 10,
      search: undefined,
      status: undefined,
      technicianId: undefined,
    });

    expect(result.totalCount).toBeNull();
    expect(prisma.job.count).not.toHaveBeenCalled();
  });
});

describe("getById", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when job not found", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getById(prisma, "non-existent");

    expect(result).toBeNull();
  });

  it("returns job with finalCost when found", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [{ totalCost: { toNumber: () => 100 } }],
      repairs: [{ price: { toNumber: () => 50 } }],
    });

    const result = await getById(prisma, "job-1");

    expect(result).not.toBeNull();
    expect(result?.finalCost).toBe(150);
  });
});

describe("getMetrics", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns metrics for all statuses", async () => {
    (prisma.job.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _count: 5, status: "PENDING" },
      { _count: 3, status: "IN_REPAIR" },
      { _count: 2, status: "COMPLETED" },
    ]);

    const result = await getMetrics(prisma);

    expect(result.PENDING).toBe(5);
    expect(result.IN_REPAIR).toBe(3);
    expect(result.COMPLETED).toBe(2);
  });

  it("returns 0 for statuses with no jobs", async () => {
    (prisma.job.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _count: 5, status: "PENDING" },
    ]);

    const result = await getMetrics(prisma);

    expect(result.PENDING).toBe(5);
    expect(result.IN_REPAIR).toBe(0);
    expect(result.CANCELLED).toBe(0);
  });
});

const OWNER_ACCESS = { canAssign: true, canSelfAssign: true };
const SELF_ASSIGN_ACCESS = { canAssign: false, canSelfAssign: true };

describe("update", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  describe("technician assignment permissions", () => {
    function mockJob(technicianId: string | null) {
      (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
        technicianId,
      });
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "tech-1",
        role: Role.TECHNICIAN,
      });
      (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
      });
    }

    it("forbids reassigning to another technician without jobs:assign", async () => {
      mockJob("tech-2");

      const result = await update(
        prisma,
        "job-1",
        { technicianId: "tech-1" },
        "tech-1",
        SELF_ASSIGN_ACCESS
      );

      expect(result).toEqual({ error: "FORBIDDEN" });
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it("forbids assigning an unassigned job to someone else with only selfAssign", async () => {
      mockJob(null);

      const result = await update(
        prisma,
        "job-1",
        { technicianId: "tech-2" },
        "tech-1",
        SELF_ASSIGN_ACCESS
      );

      expect(result).toEqual({ error: "FORBIDDEN" });
    });

    it("forbids unassigning without jobs:assign", async () => {
      mockJob("tech-1");

      const result = await update(
        prisma,
        "job-1",
        { technicianId: null },
        "tech-1",
        SELF_ASSIGN_ACCESS
      );

      expect(result).toEqual({ error: "FORBIDDEN" });
    });

    it("forbids any assignment change by default", async () => {
      mockJob(null);

      const result = await update(
        prisma,
        "job-1",
        { technicianId: "tech-1" },
        "tech-1"
      );

      expect(result).toEqual({ error: "FORBIDDEN" });
    });

    it("allows claiming an unassigned job with selfAssign", async () => {
      mockJob(null);

      const result = await update(
        prisma,
        "job-1",
        { technicianId: "tech-1" },
        "tech-1",
        SELF_ASSIGN_ACCESS
      );

      expect(result).not.toHaveProperty("error");
      expect(prisma.job.update).toHaveBeenCalled();
    });

    it("allows resending the current technician without jobs:assign", async () => {
      mockJob("tech-2");

      const result = await update(
        prisma,
        "job-1",
        { technicianId: "tech-2" },
        "tech-1"
      );

      expect(result).not.toHaveProperty("error");
    });

    it("aborts when the technician changed after the permission check", async () => {
      mockJob(null);
      (prisma.job.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      await expect(
        update(
          prisma,
          "job-1",
          { technicianId: "tech-1" },
          "tech-1",
          SELF_ASSIGN_ACCESS
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.job.updateMany).toHaveBeenCalledWith({
        where: { id: "job-1", technicianId: null },
        data: { updatedAt: expect.any(Date) },
      });
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it("allows reassignment with jobs:assign", async () => {
      mockJob("tech-2");

      const result = await update(
        prisma,
        "job-1",
        { technicianId: "tech-1" },
        "owner-1",
        OWNER_ACCESS
      );

      expect(result).not.toHaveProperty("error");
      expect(prisma.job.update).toHaveBeenCalled();
    });
  });

  it("returns null when job not found", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await update(prisma, "non-existent", {}, "user-1");

    expect(result).toBeNull();
  });

  it("returns error when job is in terminal status", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "DELIVERED",
    });

    const result = await update(prisma, "job-1", {}, "user-1");

    expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
  });

  it("returns error when technicianId is invalid", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    const result = await update(
      prisma,
      "job-1",
      { technicianId: "invalid" },
      "user-1",
      OWNER_ACCESS
    );

    expect(result).toEqual({ error: "INVALID_TECHNICIAN" });
  });

  it("returns error when technician role is not valid", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-2",
      role: Role.FRONT_DESK,
    });

    const result = await update(
      prisma,
      "job-1",
      { technicianId: "user-2" },
      "user-1",
      OWNER_ACCESS
    );

    expect(result).toEqual({ error: "INVALID_TECHNICIAN" });
  });

  it("updates job when technician has valid role", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
      technicianId: null,
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "tech-1",
      role: Role.TECHNICIAN,
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });

    const result = await update(
      prisma,
      "job-1",
      { technicianId: "tech-1" },
      "user-1",
      OWNER_ACCESS
    );

    expect(result).not.toHaveProperty("error");
    expect(prisma.job.update).toHaveBeenCalled();
  });

  it("disconnects technician when technicianId is null", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
      technicianId: "tech-1",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });

    await update(
      prisma,
      "job-1",
      { technicianId: null },
      "user-1",
      OWNER_ACCESS
    );

    const updateCall = (prisma.job.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(updateCall[0].data.technician).toEqual({ disconnect: true });
  });

  it("sets estimatedDate to null when explicitly null", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });

    await update(prisma, "job-1", { estimatedDate: null }, "user-1");

    const updateCall = (prisma.job.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(updateCall[0].data.estimatedDate).toBeNull();
  });

  it("sets depositAmount to null when explicitly null", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });

    await update(prisma, "job-1", { depositAmount: null }, "user-1");

    const updateCall = (prisma.job.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(updateCall[0].data.depositAmount).toBeNull();
  });

  it("converts estimatedDate string to Date object", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
    });

    await update(
      prisma,
      "job-1",
      { estimatedDate: new Date("2024-12-25") },
      "user-1"
    );

    const updateCall = (prisma.job.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(updateCall[0].data.estimatedDate).toBeInstanceOf(Date);
    expect(
      updateCall[0].data.estimatedDate.toISOString().startsWith("2024-12-25")
    ).toBe(true);
  });

  describe("loaner reassignment", () => {
    const jobWithLoaner = {
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "PENDING",
      hasLoanerDevice: true,
      loanerDeviceId: "unit-a",
      loanerNote: "Loja #1 (Nokia 105)",
      loanerReturnedAt: null,
    };

    function prismaWithFleet() {
      return mockPrisma({
        loanerDevice: {
          findUnique: vi.fn().mockResolvedValue({ active: true, id: "unit-b" }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            brand: "Nokia",
            id: "unit-b",
            imei: null,
            label: "Loja #2",
            model: "105",
          }),
        },
      });
    }

    it("rejects clearing the loan flag while a unit stays linked", async () => {
      (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        jobWithLoaner
      );

      const result = await update(
        prisma,
        "job-1",
        { hasLoanerDevice: false },
        "user-1"
      );

      expect(result).toEqual({
        error: "VALIDATION_ERROR",
        errors: { hasLoanerDevice: ["validations.loaner_flag_linked"] },
      });
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it("rejects a false loan flag on a newly linked unit", async () => {
      (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
        hasLoanerDevice: false,
        loanerDeviceId: null,
      });

      const result = await update(
        prisma,
        "job-1",
        { hasLoanerDevice: false, loanerDeviceId: "unit-b" },
        "user-1"
      );

      expect(result).toEqual({
        error: "VALIDATION_ERROR",
        errors: { hasLoanerDevice: ["validations.loaner_flag_linked"] },
      });
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it("rejects disconnecting a unit that is still out", async () => {
      (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        jobWithLoaner
      );

      const result = await update(
        prisma,
        "job-1",
        { loanerDeviceId: null },
        "user-1"
      );

      expect(result).toEqual({
        error: "VALIDATION_ERROR",
        errors: { loanerDeviceId: ["validations.loaner_disconnect_open"] },
      });
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it("disconnects a unit only after it was returned", async () => {
      (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...jobWithLoaner,
        loanerReturnedAt: new Date("2026-01-02"),
      });
      (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
      });

      await update(prisma, "job-1", { loanerDeviceId: null }, "user-1");

      const updateCall = (prisma.job.update as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(updateCall[0].data.loanerDevice).toEqual({ disconnect: true });
      // The return stamp survives — it records when the unit came back.
      expect(updateCall[0].data.loanerReturnedAt).toBeUndefined();
    });

    it("regenerates the printable note when the unit changes", async () => {
      const p = prismaWithFleet();
      (p.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        jobWithLoaner
      );
      (p.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
      });

      await update(p, "job-1", { loanerDeviceId: "unit-b" }, "user-1");

      const updateCall = (p.job.update as ReturnType<typeof vi.fn>).mock
        .calls[0];
      // The old unit's generated description must not survive the swap.
      expect(updateCall[0].data.loanerNote).toBe("Loja #2 (Nokia 105)");
      expect(updateCall[0].data.loanerDevice).toEqual({
        connect: { id: "unit-b" },
      });
      expect(updateCall[0].data.loanerReturnedAt).toBeNull();
    });

    it("keeps an explicit replacement note on reassignment", async () => {
      const p = prismaWithFleet();
      (p.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        jobWithLoaner
      );
      (p.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
      });

      await update(
        p,
        "job-1",
        { loanerDeviceId: "unit-b", loanerNote: "custom unit" },
        "user-1"
      );

      const updateCall = (p.job.update as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(updateCall[0].data.loanerNote).toBe("custom unit");
    });

    it("forces the loan flag on when a unit is linked", async () => {
      const p = prismaWithFleet();
      (p.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...jobWithLoaner,
        hasLoanerDevice: false,
      });
      (p.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "job-1",
        partsUsed: [],
        repairs: [],
        status: "PENDING",
      });

      await update(p, "job-1", { loanerDeviceId: "unit-b" }, "user-1");

      const updateCall = (p.job.update as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(updateCall[0].data.hasLoanerDevice).toBe(true);
    });
  });
});

describe("create", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns error when warrantyForJobId is invalid", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await create(
      prisma,
      {
        color: undefined,
        conditionNotes: undefined,
        customerEmail: undefined,
        customerId: undefined,
        customerName: "Test",
        customerPhone: "+1234567890",
        depositAmount: undefined,
        deviceBrand: "Apple",
        deviceModel: "iPhone 14",
        estimatedCost: 100,
        estimatedDate: undefined,
        isWarrantyReturn: false,
        reportedProblem: "Screen broken",
        technicianId: undefined,
        warrantyForJobId: "invalid-job",
      },
      "user-1",
      mockNotifyCtx
    );

    expect(result).toEqual({ error: "INVALID_WARRANTY_REFERENCE" });
  });

  it("returns error when warranty job is not completed", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { phone: "+1234567890" },
      status: "IN_REPAIR",
    });

    const result = await create(
      prisma,
      {
        color: undefined,
        conditionNotes: undefined,
        customerEmail: undefined,
        customerId: undefined,
        customerName: "Test",
        customerPhone: "+1234567890",
        depositAmount: undefined,
        deviceBrand: "Apple",
        deviceModel: "iPhone 14",
        estimatedCost: 100,
        estimatedDate: undefined,
        isWarrantyReturn: false,
        reportedProblem: "Screen broken",
        technicianId: undefined,
        warrantyForJobId: "job-1",
      },
      "user-1",
      mockNotifyCtx
    );

    expect(result).toEqual({ error: "INVALID_WARRANTY_REFERENCE" });
  });

  it("returns error when warranty customer phone does not match", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { phone: "+9999999999" },
      status: "COMPLETED",
    });

    const result = await create(
      prisma,
      {
        color: undefined,
        conditionNotes: undefined,
        customerEmail: undefined,
        customerId: undefined,
        customerName: "Test",
        customerPhone: "+1234567890",
        depositAmount: undefined,
        deviceBrand: "Apple",
        deviceModel: "iPhone 14",
        estimatedCost: 100,
        estimatedDate: undefined,
        isWarrantyReturn: false,
        reportedProblem: "Screen broken",
        technicianId: undefined,
        warrantyForJobId: "job-1",
      },
      "user-1",
      mockNotifyCtx
    );

    expect(result).toEqual({
      error: "INVALID_WARRANTY_REFERENCE",
    });
  });

  it("assinatura desatualizada com ficha existente não grava a correção", async () => {
    // A ficha é encontrada e a correção preparada, mas a rejeição da
    // assinatura (dentro da transação) tem de a impedir de chegar à BD —
    // em produção o rollback desfaz qualquer escrita da transação.
    const signature =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      countryCode: "PT",
      id: "default",
      intakeTerms: "Termos legais da loja",
      intakeTermsUpdatedAt: new Date("2026-11-20T10:00:00Z"),
      intakeTermsVersion: 5,
    });
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(
      (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings)
          ? strings.join(" ")
          : String(strings);
        return Promise.resolve(
          sql.includes("customers")
            ? [{ id: "cust-existing", name: "Maria", phone: "+351912345678" }]
            : [{ lastSeq: 1 }]
        );
      }
    );

    await expect(
      create(
        prisma,
        {
          customerName: "Maria Silva",
          customerPhone: "912345678",
          deviceBrand: "Apple",
          deviceModel: "iPhone 14",
          estimatedCost: 100,
          intakeLocale: "pt",
          intakeSignatureDataUrl: signature,
          intakeTermsVersion: 4,
          reportedProblem: "Ecrã partido",
        },
        "user-1",
        mockNotifyCtx
      )
    ).rejects.toMatchObject({ code: "SIGNATURE_STALE" });
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("reutiliza a ficha encontrada pelo telefone e grava as correções", async () => {
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      countryCode: "PT",
      id: "default",
    });
    // a procura SQL encontra a ficha internacionalizada; a sequência do job
    // continua a responder à outra query
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(
      (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings)
          ? strings.join(" ")
          : String(strings);
        return Promise.resolve(
          sql.includes("customers")
            ? [
                {
                  id: "cust-existing",
                  name: "Maria Silva",
                  phone: "+351912345678",
                },
              ]
            : [{ lastSeq: 1 }]
        );
      }
    );
    (prisma.customer.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "maria@x.pt",
      id: "cust-existing",
      name: "Maria Silva",
      phone: "+351912345678",
    });
    (prisma.brand.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "brand-1",
    });
    (prisma.device.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "device-1",
    });
    (prisma.job.create as ReturnType<typeof vi.fn>).mockImplementation(
      ({ data }) =>
        Promise.resolve({ ...data, id: "job-1", partsUsed: [], repairs: [] })
    );
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
    });

    await create(
      prisma,
      {
        customerEmail: "maria@x.pt",
        customerName: "Maria Silva",
        customerPhone: "912 345 678",
        deviceBrand: "Apple",
        deviceModel: "iPhone 14",
        estimatedCost: 100,
        reportedProblem: "Ecrã partido",
      },
      "user-1",
      mockNotifyCtx
    );

    // a ficha existente é corrigida — nome e email da admissão
    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: { email: "maria@x.pt", name: "Maria Silva" },
      where: { id: "cust-existing" },
    });
    // e nunca se abre segunda ficha
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
    // a reparação liga à ficha existente
    const data = (prisma.job.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data;
    expect(JSON.stringify(data.customer ?? data)).toContain("cust-existing");
  });

  it("ignores forged client terms and signs the server-resolved shop text", async () => {
    const signature =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const termsUpdatedAt = new Date("2026-11-20T10:00:00Z");
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "default",
      intakeTerms: "Termos legais da loja",
      intakeTermsUpdatedAt: termsUpdatedAt,
      intakeTermsVersion: 5,
    });
    (prisma.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: null,
      id: "customer-1",
      name: "Maria",
      phone: "912345678",
    });
    (prisma.brand.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "brand-1",
    });
    (prisma.device.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "device-1",
    });
    // O SQL cru serve duas queries distintas: a procura de cliente por
    // telefone (FROM customers) e a sequência do código da reparação.
    // Devolver a sequência nas duas faria a admissão "encontrar" uma ficha
    // fantasma — discrimina-se pelo texto da query.
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(
      (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings)
          ? strings.join(" ")
          : String(strings);
        return Promise.resolve(
          sql.includes("customers") ? [] : [{ lastSeq: 1 }]
        );
      }
    );
    (prisma.job.create as ReturnType<typeof vi.fn>).mockImplementation(
      ({ data }) =>
        Promise.resolve({
          ...data,
          id: "job-1",
          partsUsed: [],
          repairs: [],
        })
    );
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
    });

    await create(
      prisma,
      {
        customerName: "Maria",
        customerPhone: "912345678",
        deviceBrand: "Apple",
        deviceModel: "iPhone 14",
        estimatedCost: 100,
        intakeLocale: "pt",
        intakeSignatureDataUrl: signature,
        intakeTermsText: "TERMOS FALSIFICADOS PELO CLIENTE",
        intakeTermsVersion: 5,
        reportedProblem: "Ecrã partido",
      },
      "user-1",
      mockNotifyCtx
    );

    const data = (prisma.job.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data;
    expect(data.intakeTermsSnapshot.termsText).toBe("Termos legais da loja");
    expect(JSON.stringify(data.intakeTermsSnapshot)).not.toContain(
      "FALSIFICADOS"
    );
    expect(data.intakeTermsVersion).toBe(5);
    expect(data.intakeTermsUpdatedAt).toBe(termsUpdatedAt);
    const expectedHash = createHash("sha256")
      .update(canonicalize(data.intakeTermsSnapshot))
      .update("\n")
      .update(signature)
      .digest("hex");
    expect(data.intakeDocumentHash).toBe(expectedHash);
  });

  it("rejects an in-person signature over stale terms (SIGNATURE_STALE) and writes nothing", async () => {
    const signature =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "default",
      intakeTerms: "Termos legais da loja",
      intakeTermsUpdatedAt: new Date("2026-11-20T10:00:00Z"),
      intakeTermsVersion: 5,
    });

    await expect(
      create(
        prisma,
        {
          customerName: "Maria",
          customerPhone: "912345678",
          deviceBrand: "Apple",
          deviceModel: "iPhone 14",
          estimatedCost: 100,
          intakeLocale: "pt",
          intakeSignatureDataUrl: signature,
          intakeTermsVersion: 4,
          reportedProblem: "Ecrã partido",
        },
        "user-1",
        mockNotifyCtx
      )
    ).rejects.toMatchObject({ code: "SIGNATURE_STALE" });

    // A versão errada é rejeitada antes de qualquer escrita: sem job, sem
    // cliente novo, sem marca/dispositivo criados pela ficha rejeitada.
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.device.upsert).not.toHaveBeenCalled();
    expect(prisma.brand.create).not.toHaveBeenCalled();
  });

  it("returns error when customerId is invalid", async () => {
    (prisma.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    const result = await create(
      prisma,
      {
        color: undefined,
        conditionNotes: undefined,
        customerEmail: undefined,
        customerId: "invalid-customer",
        customerName: "Test",
        customerPhone: "+1234567890",
        depositAmount: undefined,
        deviceBrand: "Apple",
        deviceModel: "iPhone 14",
        estimatedCost: 100,
        estimatedDate: undefined,
        isWarrantyReturn: false,
        reportedProblem: "Screen broken",
        technicianId: undefined,
        warrantyForJobId: undefined,
      },
      "user-1",
      mockNotifyCtx
    );

    expect(result).toEqual({ error: "INVALID_CUSTOMER" });
  });
});

describe("transitionStatus", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when job not found", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await transitionStatus(
      prisma,
      "non-existent",
      "IN_REPAIR",
      "user-1",
      mockNotifyCtx
    );

    expect(result).toBeNull();
  });

  it("returns error for invalid status transition", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "DELIVERED",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "INTAKE" as unknown as import("@shared/constants").JobStatusType,
      "user-1",
      mockNotifyCtx
    );

    expect(result).toHaveProperty("error", "CONFLICT_STATUS_TRANSITION");
    expect(result).toHaveProperty("currentStatus", "DELIVERED");
    expect(result).toHaveProperty("allowedTransitions");
  });

  it("allows valid status transition", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "INTAKE",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "IN_REPAIR",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "IN_REPAIR",
      "user-1",
      mockNotifyCtx
    );

    expect(result).not.toHaveProperty("error");
    expect(prisma.job.update).toHaveBeenCalled();
  });

  it("allows IN_REPAIR -> WAITING_FOR_PARTS (part found missing mid-repair)", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "IN_REPAIR",
      technicianId: "user-1",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "WAITING_FOR_PARTS",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "WAITING_FOR_PARTS",
      "user-1",
      mockNotifyCtx
    );

    expect(result).not.toHaveProperty("error");
    expect(prisma.job.update).toHaveBeenCalled();
  });

  it("rejects CANCELLED transition by FRONT_DESK when not creator", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      createdById: "other-user",
      id: "job-1",
      status: "INTAKE",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "CANCELLED",
      "user-1",
      mockNotifyCtx,
      { requestingRole: Role.FRONT_DESK }
    );

    expect(result).toEqual({ error: "CANCEL_NOT_CREATOR" });
  });

  it("rejects CANCELLED transition by FRONT_DESK after 30 minute window", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date(Date.now() - 31 * 60 * 1000), // 31 minutes ago
      createdById: "user-1",
      id: "job-1",
      status: "INTAKE",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "CANCELLED",
      "user-1",
      mockNotifyCtx,
      { requestingRole: Role.FRONT_DESK }
    );

    expect(result).toEqual({ error: "CANCEL_WINDOW_EXPIRED" });
  });

  it("allows CANCELLED transition by FRONT_DESK within 30 min window and as creator", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      createdById: "user-1",
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "INTAKE",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "CANCELLED",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "CANCELLED",
      "user-1",
      mockNotifyCtx,
      { requestingRole: Role.FRONT_DESK }
    );

    expect(result).not.toHaveProperty("error");
  });

  it("returns REWORK_JOB_HAS_OPEN_CLAIM when cancelling a rework job whose claim is OPEN", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rework-1",
      status: "IN_REPAIR",
      isWarrantyReturn: true,
      createdById: "user-1",
    });
    (
      prisma.returnClaim.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      reworkJobId: "rework-1",
    });

    const result = await transitionStatus(
      prisma,
      "rework-1",
      "CANCELLED",
      "user-1",
      mockNotifyCtx,
      { requestingRole: Role.TECHNICIAN }
    );

    expect(result).toEqual({ error: "REWORK_JOB_HAS_OPEN_CLAIM" });
  });

  it("refuses DELIVERED under the job lock when an external repair is open", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "DONE",
    });
    (
      prisma.externalRepair.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "er-1" });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "DELIVERED",
      "user-1",
      mockNotifyCtx,
      { requestingRole: Role.OWNER }
    );

    expect(result).toHaveProperty("error", "CONFLICT_STATUS_TRANSITION");
    expect(result).toHaveProperty("currentStatus", "DONE");
    // DELIVERED must not be advertised as an allowed alternative.
    expect(
      (result as { allowedTransitions?: string[] }).allowedTransitions
    ).not.toContain("DELIVERED");
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it("records the handover payment inside the delivery transaction", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      depositAmount: null,
      id: "job-1",
      partsUsed: [{ totalCost: { toNumber: () => 20 } }],
      payments: [],
      repairs: [{ price: { toNumber: () => 100 } }],
      status: "DONE",
    });
    (prisma.job.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { name: "Cliente", phone: null },
      id: "job-1",
      jobCode: "J-1",
      partsUsed: [],
      repairs: [],
      status: "DELIVERED",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "DELIVERED",
      "user-1",
      mockNotifyCtx,
      {
        payment: { amount: 50, method: "CASH" },
        requestingRole: Role.OWNER,
      }
    );

    expect(result).not.toHaveProperty("error");
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 50, method: "CASH" }),
      })
    );
    expect(prisma.job.update).toHaveBeenCalled();
  });

  it("rejects a handover payment above the locked balance", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      depositAmount: null,
      id: "job-1",
      partsUsed: [],
      payments: [],
      repairs: [],
      status: "DONE",
    });

    await expect(
      transitionStatus(prisma, "job-1", "DELIVERED", "user-1", mockNotifyCtx, {
        payment: { amount: 50, method: "CASH" },
        requestingRole: Role.OWNER,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE" });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it("rejects a payment payload on non-DELIVERED transitions", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      partsUsed: [],
      repairs: [],
      status: "IN_REPAIR",
    });

    const result = await transitionStatus(
      prisma,
      "job-1",
      "DONE",
      "user-1",
      mockNotifyCtx,
      {
        payment: { amount: 10, method: "CASH" },
        requestingRole: Role.OWNER,
      }
    );

    expect(result).toEqual({ error: "VALIDATION_ERROR" });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});
