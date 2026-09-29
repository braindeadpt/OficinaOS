import { beforeEach, describe, expect, it, vi } from "vitest";
import { suggestRestock } from "../restock-suggestion.service.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");

function makePrisma(
  part: unknown,
  movements: Array<{ createdAt: Date; quantity: number; type: string }>
) {
  return {
    partsCatalog: { findUnique: vi.fn().mockResolvedValue(part) },
    stockMovement: {
      // Honors the where.type filter like the real query would.
      findMany: vi
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            movements.filter((m) => !where?.type || m.type === where.type)
          )
        ),
    },
  } as unknown as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("suggestRestock", () => {
  it("returns null for unknown part", async () => {
    const prisma = makePrisma(null, []);
    expect(await suggestRestock(prisma, "nope", NOW)).toBeNull();
  });

  it("computes avg consumption, reorder point and suggestion", async () => {
    // 30 consumed units over the window (e.g. 15 × 2) → 1/day average.
    const movements = Array.from({ length: 15 }, (_, i) => ({
      createdAt: new Date(NOW.getTime() - (i + 1) * 24 * 60 * 60 * 1000),
      quantity: -2,
      type: "CONSUMPTION",
    }));
    const prisma = makePrisma(
      {
        isActive: true,
        name: "iPhone 14 Screen",
        reorderLevel: 5,
        stockQuantity: 3,
        supplier: "iSupply",
      },
      movements
    );

    const s = await suggestRestock(prisma, "part-1", NOW);

    expect(s).toEqual({
      avgDailyConsumption: 1,
      daysOfStockLeft: 3,
      recentConsumedTotal: 30,
      reorderPoint: 14,
      soldOutNow: false,
      stockQuantity: 3,
      suggestedQuantity: 11,
      supplier: "iSupply",
      windowDays: 30,
    });
    // CONSUMPTION-only lookup inside the 30-day window.
    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "CONSUMPTION",
          partId: "part-1",
        }),
      })
    );
  });

  it("returns zeros and no days estimate without ledger data", async () => {
    const prisma = makePrisma(
      {
        isActive: true,
        name: "Cable",
        reorderLevel: 2,
        stockQuantity: 0,
        supplier: null,
      },
      []
    );

    const s = await suggestRestock(prisma, "part-1", NOW);

    expect(s).toEqual({
      avgDailyConsumption: 0,
      daysOfStockLeft: null,
      recentConsumedTotal: 0,
      reorderPoint: 0,
      soldOutNow: true,
      stockQuantity: 0,
      suggestedQuantity: 0,
      supplier: null,
      windowDays: 30,
    });
  });

  it("ignores PURCHASE movements in the average", async () => {
    const movements = [
      {
        createdAt: new Date(NOW.getTime() - 86_400_000),
        quantity: 50,
        type: "PURCHASE",
      },
      {
        createdAt: new Date(NOW.getTime() - 172_800_000),
        quantity: -4,
        type: "CONSUMPTION",
      },
    ];
    const prisma = makePrisma(
      {
        isActive: true,
        name: "P",
        reorderLevel: 0,
        stockQuantity: 10,
        supplier: null,
      },
      movements
    );

    const s = await suggestRestock(prisma, "part-1", NOW);
    expect(s?.recentConsumedTotal).toBe(4);
    expect(s?.avgDailyConsumption).toBeCloseTo(0.13, 2);
  });
});
