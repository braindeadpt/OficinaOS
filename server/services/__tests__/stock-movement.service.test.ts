import { AppError } from "@shared/errors/app-error.js";
import { describe, expect, it, vi } from "vitest";
import {
  listByPart,
  recordAdjustment,
  recordPurchase,
} from "../stock-movement.service.js";

function makePrisma(stockQuantity = 5) {
  const prisma = {
    partsCatalog: {
      findUnique: vi.fn().mockResolvedValue({
        id: "part-1",
        stockQuantity,
      }),
      update: vi.fn().mockImplementation(({ data }) => {
        // Handles both { increment } (purchase) and absolute set (adjustment)
        if (typeof data.stockQuantity === "number") {
          return Promise.resolve({ stockQuantity: data.stockQuantity });
        }
        const inc = data.stockQuantity?.increment ?? 0;
        return Promise.resolve({
          stockQuantity: stockQuantity + inc,
        });
      }),
    },
    stockMovement: {
      create: vi.fn().mockResolvedValue({ id: "mov-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma as unknown as any;
}

describe("recordPurchase", () => {
  it("increments stock and appends a PURCHASE movement", async () => {
    const prisma = makePrisma(5);

    const result = await recordPurchase(
      prisma,
      "part-1",
      { quantity: 10, unitCost: 250, supplier: "iSupply" },
      "user-1"
    );

    expect(result?.stockQuantity).toBe(15);
    expect(prisma.partsCatalog.update).toHaveBeenCalledWith({
      where: { id: "part-1" },
      data: { stockQuantity: { increment: 10 } },
      select: { stockQuantity: true },
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        balanceAfter: 15,
        quantity: 10,
        supplier: "iSupply",
        type: "PURCHASE",
        unitCost: 250,
      }),
    });
  });

  it("returns null for an unknown part", async () => {
    const prisma = makePrisma(5);
    prisma.partsCatalog.findUnique.mockResolvedValue(null);

    const result = await recordPurchase(
      prisma,
      "nope",
      { quantity: 1 },
      "user-1"
    );
    expect(result).toBeNull();
  });
});

describe("recordAdjustment", () => {
  it("applies a signed delta and records an ADJUSTMENT", async () => {
    const prisma = makePrisma(5);

    const result = await recordAdjustment(
      prisma,
      "part-1",
      { quantity: -2, note: "damaged units" },
      "user-1"
    );

    expect(result?.stockQuantity).toBe(3);
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        balanceAfter: 3,
        quantity: -2,
        type: "ADJUSTMENT",
      }),
    });
  });

  it("rejects adjustments below zero", async () => {
    const prisma = makePrisma(2);

    await expect(
      recordAdjustment(prisma, "part-1", { quantity: -5 }, "user-1")
    ).rejects.toThrow(AppError);
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });
});

describe("listByPart", () => {
  it("returns movements with cursor when more exist", async () => {
    const prisma = makePrisma(5);
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `m${i + 1}` }));
    prisma.stockMovement.findMany.mockResolvedValue(rows);
    prisma.stockMovement.count.mockResolvedValue(4);

    const result = await listByPart(prisma, "part-1", { limit: 3 });

    expect(result.movements).toHaveLength(3);
    expect(result.nextCursor).toBe("m4");
    expect(result.totalCount).toBe(4);
  });
});
