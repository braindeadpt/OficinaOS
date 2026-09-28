import { describe, expect, it, vi } from "vitest";
import { partsConsumptionReport } from "../parts-consumption.service.js";

function makePrisma() {
  return {
    jobPart: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
    saleItem: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  } as unknown as any;
}

const ownerScope = { role: "OWNER", userId: "u1" } as any;
const techScope = { role: "TECHNICIAN", userId: "t1" } as any;

const range = {
  start: new Date("2026-09-01T00:00:00Z"),
  end: new Date("2026-09-28T00:00:00Z"),
};

describe("partsConsumptionReport", () => {
  it("merges job parts and POS sales by name", async () => {
    const prisma = makePrisma();
    (prisma.jobPart.groupBy as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }) => {
        if (where.createdAt?.gte?.getTime() === range.start.getTime()) {
          return Promise.resolve([
            {
              partName: "iPhone 14 Screen",
              category: "SCREEN",
              _count: { _all: 4 },
              _avg: { unitPrice: 3000 },
              _sum: { quantity: 5, totalCost: 15_000 },
            },
          ]);
        }
        return Promise.resolve([]);
      }
    );
    (prisma.saleItem.groupBy as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }) => {
        if (where.sale?.createdAt?.gte?.getTime() === range.start.getTime()) {
          return Promise.resolve([
            {
              name: "iPhone 14 Screen",
              category: "SCREEN",
              _count: { _all: 2 },
              _avg: { unitPrice: 3500 },
              _sum: { quantity: 2, lineTotal: 7000 },
            },
            {
              name: "Tempered glass",
              category: "OTHER",
              _count: { _all: 6 },
              _avg: { unitPrice: 500 },
              _sum: { quantity: 6, lineTotal: 3000 },
            },
          ]);
        }
        return Promise.resolve([]);
      }
    );

    const result = await partsConsumptionReport(
      prisma,
      ownerScope,
      range,
      true
    );

    expect(result.includePosSales).toBe(true);
    // Same accessory via jobs + POS merges into one row keyed by name.
    const screen = result.topParts.find(
      (r) => r.partName === "iPhone 14 Screen"
    );
    expect(screen).toBeDefined();
    expect(screen?.quantity).toBe(7);
    expect(screen?.usageCount).toBe(6);
    expect(screen?.totalCost).toBe(22_000);
    expect(result.summary.totalQuantity).toBe(13);
    expect(result.summary.distinctParts).toBe(2);
    expect(result.summary.totalCost).toBe(25_000);
  });

  it("computes trend vs the previous equivalent period", async () => {
    const prisma = makePrisma();
    (prisma.jobPart.groupBy as ReturnType<typeof vi.fn>).mockImplementation(
      ({ where }) => {
        const isCurrent =
          where.createdAt?.gte?.getTime() === range.start.getTime();
        if (isCurrent) {
          return Promise.resolve([
            {
              partName: "Battery",
              category: "BATTERY",
              _count: { _all: 2 },
              _avg: { unitPrice: 900 },
              _sum: { quantity: 8, totalCost: 7200 },
            },
          ]);
        }
        return Promise.resolve([
          {
            partName: "Battery",
            category: "BATTERY",
            _count: { _all: 2 },
            _avg: { unitPrice: 900 },
            _sum: { quantity: 4, totalCost: 3600 },
          },
        ]);
      }
    );

    const result = await partsConsumptionReport(
      prisma,
      ownerScope,
      range,
      false
    );

    expect(result.topParts[0].quantityChangePercent).toBe(100);
    expect(result.summary.totalQuantityChangePercent).toBe(100);
    expect(result.includePosSales).toBe(false);
  });

  it("scopes technician rows to their own jobs", async () => {
    const prisma = makePrisma();
    (prisma.jobPart.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await partsConsumptionReport(prisma, techScope, range, false);

    const where = (prisma.jobPart.groupBy as ReturnType<typeof vi.fn>).mock
      .calls[0][0].where;
    expect(where.job).toEqual({ technicianId: "t1" });
  });

  it("returns empty summary when nothing was consumed", async () => {
    const prisma = makePrisma();

    const result = await partsConsumptionReport(
      prisma,
      ownerScope,
      range,
      true
    );

    expect(result.topParts).toEqual([]);
    expect(result.summary.totalQuantity).toBe(0);
    expect(result.summary.totalQuantityChangePercent).toBeUndefined();
  });
});
