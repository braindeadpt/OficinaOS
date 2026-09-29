import { AppError } from "@shared/errors/app-error.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listByPart,
  recordAdjustment,
  recordPurchase,
} from "../stock-movement.service.js";

/**
 * The raw adjustment UPDATE returns its row only when the conditional WHERE
 * admitted it; an empty array means the guard rejected the delta.
 */
function makePrisma(stockQuantity = 5) {
  const current = { value: stockQuantity };
  const prisma = {
    current,
    partsCatalog: {
      findUnique: vi.fn().mockResolvedValue({
        id: "part-1",
      }),
      update: vi.fn().mockImplementation(({ data }) => {
        const inc = data.stockQuantity?.increment ?? 0;
        current.value += inc;
        return Promise.resolve({ stockQuantity: current.value });
      }),
      // Mirrors the service's atomic UPDATE: applies the signed delta only
      // when the running balance would stay non-negative. SQL param order is
      // (delta, partId, delta).
      $queryRaw: vi
        .fn()
        .mockImplementation(
          (_segments: TemplateStringsArray, ...params: unknown[]) => {
            const delta = params[0] as number;
            if (current.value + delta < 0) {
              return Promise.resolve([]);
            }
            current.value += delta;
            return Promise.resolve([{ stockQuantity: current.value }]);
          }
        ),
    },
    stockMovement: {
      create: vi.fn().mockResolvedValue({ id: "mov-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ ...prisma, $queryRaw: prisma.partsCatalog.$queryRaw })
    ),
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

  it("applies the delta atomically instead of writing a stale absolute value", async () => {
    // Regression: the adjustment used to read the balance outside the
    // transaction and write that number back, so a concurrent change between
    // the read and the write was silently overwritten.
    const prisma = makePrisma(5);
    await recordAdjustment(prisma, "part-1", { quantity: -2 }, "user-1");

    const [segments, ...params] = prisma.partsCatalog.$queryRaw.mock.calls[0];
    const sql = segments.join("?");
    expect(sql).toContain('stockQuantity" + ?');
    expect(sql).toContain("+ ? >= 0");
    expect(params[0]).toBe(-2);
    expect(params[1]).toBe("part-1");
    // No absolute write outside the conditional UPDATE.
    expect(prisma.partsCatalog.update).not.toHaveBeenCalled();
  });

  it("does not mutate the stored balance when the guard rejects", async () => {
    const prisma = makePrisma(4);
    await expect(
      recordAdjustment(prisma, "part-1", { quantity: -9 }, "user-1")
    ).rejects.toThrow("errors.insufficient_stock");
    expect(prisma.current.value).toBe(4);
  });
});

describe("listByPart", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma(5);
  });

  it("returns movements with cursor when more exist", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `m${i + 1}` }));
    prisma.stockMovement.findMany.mockResolvedValue(rows);
    prisma.stockMovement.count.mockResolvedValue(4);

    const result = await listByPart(prisma, "part-1", { limit: 3 });

    expect(result.movements).toHaveLength(3);
    expect(result.nextCursor).toBe("m4");
    expect(result.totalCount).toBe(4);
  });

  it("pages on createdAt with an id tiebreak", async () => {
    prisma.stockMovement.findMany.mockResolvedValue([]);

    await listByPart(prisma, "part-1", { limit: 3 });

    const call = prisma.stockMovement.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});
