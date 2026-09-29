import { describe, expect, it, vi } from "vitest";
import { restockForecast } from "../restock-forecast.service.js";

function makePrisma() {
  return {
    partsCatalog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    stockMovement: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  } as unknown as any;
}

function partRows(rows: Record<string, unknown>[]) {
  return rows.map((overrides) => ({
    id: "p1",
    name: "iPhone 14 Screen",
    reorderLevel: 5,
    stockQuantity: 10,
    supplier: "Apple Store",
    ...overrides,
  }));
}

const NOW = new Date("2026-09-29T14:30:00Z");

describe("restockForecast", () => {
  it("estimates days left and suggests window demand when stock is short", async () => {
    const prisma = makePrisma();
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(partRows([{}]));
    (
      prisma.stockMovement.groupBy as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ _sum: { quantity: -150 }, partId: "p1" }]);

    const result = await restockForecast(prisma, NOW);

    expect(result.windowDays).toBe(30);
    // 150 consumed over 30 days = 5/day → 10 units = 2 days left.
    expect(result.rows[0].avgDailyUsage).toBe(5);
    expect(result.rows[0].daysLeft).toBe(2);
    // Demand for the window (150) exceeds reorder level (5) → buy 150 - 10.
    expect(result.rows[0].suggestedQuantity).toBe(140);
    expect(result.summary.partsAtRisk).toBe(1);
    expect(result.summary.totalSuggestedQuantity).toBe(140);
  });

  it("returns no suggestion when stock covers the reorder target", async () => {
    const prisma = makePrisma();
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(partRows([{ stockQuantity: 500 }]));
    (
      prisma.stockMovement.groupBy as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ _sum: { quantity: -150 }, partId: "p1" }]);

    const result = await restockForecast(prisma, NOW);

    expect(result.rows).toEqual([]);
    expect(result.summary.partsAtRisk).toBe(0);
  });

  it("suggests the reorder level for parts with no consumption history", async () => {
    const prisma = makePrisma();
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(partRows([{ reorderLevel: 8, stockQuantity: 2 }]));
    (
      prisma.stockMovement.groupBy as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const result = await restockForecast(prisma, NOW);

    expect(result.rows[0].avgDailyUsage).toBe(0);
    expect(result.rows[0].daysLeft).toBeNull();
    // No usage → target is the reorder level itself (8) minus stock (2).
    expect(result.rows[0].suggestedQuantity).toBe(6);
  });

  it("ignores PURCHASE/RETURN/ADJUSTMENT rows via the CONSUMPTION filter", async () => {
    const prisma = makePrisma();
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    await restockForecast(prisma, NOW);

    const where = (prisma.stockMovement.groupBy as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].where;
    expect(where.type).toBe("CONSUMPTION");
    expect(where.createdAt.gte).toBeDefined();
  });

  it("sorts the most urgent parts first", async () => {
    const prisma = makePrisma();
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      partRows([
        { id: "p1", stockQuantity: 40, reorderLevel: 5 },
        { id: "p2", stockQuantity: 4, reorderLevel: 5 },
      ])
    );
    (
      prisma.stockMovement.groupBy as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      { _sum: { quantity: -60 }, partId: "p1" }, // 2/day → 20 days left
      { _sum: { quantity: -60 }, partId: "p2" }, // 2/day → 2 days left
    ]);

    const result = await restockForecast(prisma, NOW);

    expect(result.rows.map((r) => r.partId)).toEqual(["p2", "p1"]);
  });
});
