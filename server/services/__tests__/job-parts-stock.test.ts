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
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (callback) => callback(mock)),
  };
  return mock as unknown as PrismaClient;
}

describe("stock atomicity", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "IN_REPAIR",
    });
  });

  it("decrements stock when a catalog part is added", async () => {
    (prisma.jobPart.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
    });

    await add(
      prisma,
      "job-1",
      {
        category: "SCREEN",
        partId: "catalog-1",
        partName: "iPhone 14 Screen",
        quantity: 2,
        supplier: undefined,
        unitPrice: 150,
      },
      "user-1"
    );

    expect(prisma.partsCatalog.updateMany).toHaveBeenCalledWith({
      where: { id: "catalog-1", stockQuantity: { gte: 2 } },
      data: { stockQuantity: { decrement: 2 } },
    });
  });

  it("does not touch stock for ad-hoc parts (no partId)", async () => {
    (prisma.jobPart.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
    });

    await add(
      prisma,
      "job-1",
      {
        category: "OTHER",
        partId: undefined,
        partName: "Mystery flex cable",
        quantity: 1,
        supplier: undefined,
        unitPrice: 10,
      },
      "user-1"
    );

    expect(prisma.partsCatalog.updateMany).not.toHaveBeenCalled();
  });

  it("returns INSUFFICIENT_STOCK and creates nothing when stock is short", async () => {
    (
      prisma.partsCatalog.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 0 });

    const result = await add(
      prisma,
      "job-1",
      {
        category: "BATTERY",
        partId: "catalog-1",
        partName: "iPhone Battery",
        quantity: 5,
        supplier: undefined,
        unitPrice: 50,
      },
      "user-1"
    );

    expect(result).toEqual({ error: "INSUFFICIENT_STOCK" });
    expect(prisma.jobPart.create).not.toHaveBeenCalled();
    expect(prisma.partsCatalog.updateMany).toHaveBeenCalled();
  });

  it("restores stock when a consumed catalog part line is removed", async () => {
    (prisma.jobPart.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      job: { status: "IN_REPAIR" },
      partId: "catalog-1",
      partName: "Screen",
      quantity: 3,
    });

    const result = await remove(prisma, "job-1", "part-1", "user-1");

    expect(result).toBe(true);
    expect(prisma.partsCatalog.update).toHaveBeenCalledWith({
      where: { id: "catalog-1" },
      data: { stockQuantity: { increment: 3 } },
    });
  });

  it("does not touch stock when removing an ad-hoc part line", async () => {
    (prisma.jobPart.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      job: { status: "IN_REPAIR" },
      partId: null,
      partName: "Mystery part",
      quantity: 1,
    });

    const result = await remove(prisma, "job-1", "part-1", "user-1");

    expect(result).toBe(true);
    expect(prisma.partsCatalog.update).not.toHaveBeenCalled();
  });
});
