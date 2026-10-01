import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants";
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
    expect(result.job?.customer).toEqual({ name: "John Doe" });
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

describe("update", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
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
      "user-1"
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
      "user-1"
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
      "user-1"
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

    await update(prisma, "job-1", { technicianId: null }, "user-1");

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
});
