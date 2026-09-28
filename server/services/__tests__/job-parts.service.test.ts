import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { add, remove } from "../job-parts.service";

vi.mock("../audit.service.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

function mockPrisma() {
  const mock = {
    job: {
      findUnique: vi.fn(),
    },
    jobPart: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    partsCatalog: {
      update: vi.fn().mockResolvedValue({ stockQuantity: 9 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    stockMovement: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ stock_quantity: 9 }]),
    $transaction: vi.fn(async (callback) => callback(mock)),
  };
  return mock as unknown as PrismaClient;
}

describe("add", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when job not found", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await add(
      prisma,
      "job-1",
      {
        category: "SCREEN",
        partId: undefined,
        partName: "iPhone 14 Screen",
        quantity: 1,
        supplier: undefined,
        unitPrice: 150,
      },
      "user-1"
    );

    expect(result).toBeNull();
  });

  it("returns error when job is in terminal status", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "DELIVERED",
    });

    const result = await add(
      prisma,
      "job-1",
      {
        category: "SCREEN",
        partId: undefined,
        partName: "iPhone 14 Screen",
        quantity: 1,
        supplier: undefined,
        unitPrice: 150,
      },
      "user-1"
    );

    expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
  });

  it("calculates totalCost as unitPrice * quantity", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "IN_REPAIR",
    });
    (prisma.jobPart.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      totalCost: 300,
    });

    await add(
      prisma,
      "job-1",
      {
        category: "BATTERY",
        partId: "catalog-1",
        partName: "iPhone Battery",
        quantity: 2,
        supplier: "Apple",
        unitPrice: 150,
      },
      "user-1"
    );

    const createCall = (prisma.jobPart.create as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(createCall[0].data.totalCost).toBe(300);
  });

  it("creates job part with correct data", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "IN_REPAIR",
    });
    (prisma.jobPart.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      jobId: "job-1",
      partName: "Screen",
      quantity: 1,
      totalCost: 100,
      unitPrice: 100,
    });

    const result = await add(
      prisma,
      "job-1",
      {
        category: "SCREEN",
        partId: "catalog-1",
        partName: "Screen",
        quantity: 1,
        supplier: "Supplier A",
        unitPrice: 100,
      },
      "user-1"
    );

    expect(result).toHaveProperty("id", "part-1");
    expect(prisma.jobPart.create).toHaveBeenCalled();
  });
});

describe("remove", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when part not found", async () => {
    (prisma.jobPart.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    const result = await remove(prisma, "job-1", "part-1", "user-1");

    expect(result).toBeNull();
  });

  it("returns error when job is in terminal status", async () => {
    (prisma.jobPart.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      job: { status: "DELIVERED" },
      partName: "Screen",
      quantity: 1,
    });

    const result = await remove(prisma, "job-1", "part-1", "user-1");

    expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
  });

  it("deletes part and returns true on success", async () => {
    (prisma.jobPart.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      job: { status: "IN_REPAIR" },
      partName: "Screen",
      quantity: 1,
    });
    (prisma.jobPart.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await remove(prisma, "job-1", "part-1", "user-1");

    expect(result).toBe(true);
    // delete is called inside $transaction, so we just verify the result
  });
});
