import { AppError } from "@shared/errors/app-error.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertLowStock: vi.fn().mockResolvedValue(true),
}));

vi.mock("../low-stock.service.js", () => ({
  alertLowStock: mocks.alertLowStock,
}));

vi.mock("../../utils/sale-code.js", () => ({
  generateSaleCode: vi.fn().mockResolvedValue("SALE-2026-000001"),
}));

import { create, getById, list } from "../sale.service.js";

function makePrisma(
  catalogParts: Array<{ id: string; stockQuantity: number }>
) {
  const prisma = {
    partsCatalog: {
      findMany: vi.fn().mockResolvedValue(catalogParts),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    stockMovement: {
      create: vi.fn().mockResolvedValue({}),
    },
    sale: {
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "sale-1", saleCode: data.saleCode })
        ),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma as unknown as any;
}

function makeApp() {
  return { log: { warn: vi.fn(), error: vi.fn() } } as unknown as any;
}

const baseInput = {
  items: [
    {
      category: "SCREEN" as const,
      name: "iPhone 14 Screen",
      partId: "part-1",
      quantity: 2,
      unitPrice: 3500,
    },
  ],
  payments: [{ amount: 7000, method: "CASH" as const }],
};

describe("create sale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a sale with snapshotted items and decrements stock", async () => {
    const prisma = makePrisma([{ id: "part-1", stockQuantity: 10 }]);

    const result = await create(prisma, makeApp(), baseInput, "user-1");

    expect(result).toEqual({
      id: "sale-1",
      saleCode: "SALE-2026-000001",
    });
    expect(prisma.partsCatalog.updateMany).toHaveBeenCalledWith({
      where: { id: "part-1", stockQuantity: { gte: 2 } },
      data: { stockQuantity: { decrement: 2 } },
    });
    expect(prisma.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: 7000,
          saleCode: "SALE-2026-000001",
        }),
      })
    );
  });

  it("supports ad-hoc items without stock operations", async () => {
    const prisma = makePrisma([]);
    const input = {
      items: [
        {
          category: "OTHER" as const,
          name: "Screen protector",
          quantity: 1,
          unitPrice: 500,
        },
      ],
      payments: [{ amount: 500, method: "CASH" as const }],
    };

    const result = await create(prisma, makeApp(), input, "user-1");

    expect(result.saleCode).toBe("SALE-2026-000001");
    expect(prisma.partsCatalog.updateMany).not.toHaveBeenCalled();
  });

  it("aborts and rolls back when stock is insufficient", async () => {
    const prisma = makePrisma([{ id: "part-1", stockQuantity: 10 }]);
    prisma.partsCatalog.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      create(prisma, makeApp(), baseInput, "user-1")
    ).rejects.toThrow(AppError);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it("rejects unknown catalog part ids", async () => {
    const prisma = makePrisma([]);

    await expect(
      create(prisma, makeApp(), baseInput, "user-1")
    ).rejects.toThrow(AppError);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it("fires the low-stock hook inside the transaction", async () => {
    const prisma = makePrisma([{ id: "part-1", stockQuantity: 10 }]);

    await create(prisma, makeApp(), baseInput, "user-1");

    expect(mocks.alertLowStock).toHaveBeenCalledWith(
      expect.anything(),
      "part-1",
      prisma
    );
  });

  it("writes a CONSUMPTION ledger entry per catalog line", async () => {
    const prisma = makePrisma([{ id: "part-1", stockQuantity: 10 }]);

    await create(prisma, makeApp(), baseInput, "user-1");

    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        balanceAfter: 8,
        createdById: "user-1",
        partId: "part-1",
        quantity: -2,
        type: "CONSUMPTION",
      },
    });
  });

  it("skips ledger entries for ad-hoc items", async () => {
    const prisma = makePrisma([]);
    const input = {
      items: [
        {
          category: "OTHER" as const,
          name: "Screen protector",
          quantity: 1,
          unitPrice: 500,
        },
      ],
      payments: [{ amount: 500, method: "CASH" as const }],
    };

    await create(prisma, makeApp(), input, "user-1");

    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });
});

describe("getById / list", () => {
  it("returns null via findUnique passthrough", async () => {
    const prisma = makePrisma([]);
    prisma.sale.findUnique.mockResolvedValue(null);

    const result = await getById(prisma, "nope");
    expect(result).toBeNull();
  });

  it("lists sales with cursor pagination", async () => {
    const prisma = makePrisma([]);
    prisma.sale.findMany.mockResolvedValue([
      { id: "s1" },
      { id: "s2" },
      { id: "s3" },
    ]);

    const result = await list(prisma, { limit: 2 });
    expect(result.sales).toHaveLength(2);
    // Cursor is the popped overflow item's id (matches jobs list pattern).
    expect(result.nextCursor).toBe("s3");
  });
});
