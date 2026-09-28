import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../notification-dispatch.js", () => ({
  notify: mocks.notify,
}));

vi.useFakeTimers();

const mockLog = { error: vi.fn(), warn: vi.fn() };

import type { LowStockTx } from "../low-stock.service.js";
import { alertLowStock } from "../low-stock.service.js";

function makeApp() {
  return { log: mockLog } as any;
}

function makeTx(part: Record<string, unknown> | null): LowStockTx {
  return {
    partsCatalog: {
      findUnique: vi.fn().mockResolvedValue(part),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as LowStockTx;
}

describe("alertLowStock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies OWNERs when stock is at reorder level", async () => {
    const tx = makeTx({
      isActive: true,
      name: "iPhone 14 Screen",
      reorderLevel: 2,
      stockQuantity: 2,
    });

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(true);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: {
          partName: "iPhone 14 Screen",
          partQuantity: "2",
          partReorderLevel: "2",
        },
        eventName: "part_low_stock",
        recipients: { role: "OWNER" },
      })
    );
    expect(tx.partsCatalog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastLowStockAlertAt: expect.any(Date) },
      })
    );
  });

  it("notifies when stock is below reorder level", async () => {
    const tx = makeTx({
      isActive: true,
      name: "Battery",
      reorderLevel: 3,
      stockQuantity: 0,
    });

    const result = await alertLowStock(makeApp(), "part-1", tx);
    expect(result).toBe(true);
  });

  it("skips parts above reorder level", async () => {
    const tx = makeTx({
      isActive: true,
      name: "Screen",
      reorderLevel: 2,
      stockQuantity: 5,
    });

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(tx.partsCatalog.updateMany).not.toHaveBeenCalled();
  });

  it("skips parts with reorder level zero", async () => {
    const tx = makeTx({
      isActive: true,
      name: "Screen",
      reorderLevel: 0,
      stockQuantity: 0,
    });

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("skips inactive parts", async () => {
    const tx = makeTx({
      isActive: false,
      name: "Old part",
      reorderLevel: 2,
      stockQuantity: 0,
    });

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("skips when the gate claim loses the race (recently alerted)", async () => {
    const tx = makeTx({
      isActive: true,
      name: "Screen",
      reorderLevel: 2,
      stockQuantity: 1,
    });
    (tx.partsCatalog.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("swallows notification errors so stock ops never fail", async () => {
    const tx = makeTx({
      isActive: true,
      name: "Screen",
      reorderLevel: 2,
      stockQuantity: 1,
    });
    mocks.notify.mockRejectedValueOnce(new Error("WS down"));

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(false);
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it("swallows DB errors from the part lookup", async () => {
    const tx = makeTx(null);
    (tx.partsCatalog.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down")
    );

    const result = await alertLowStock(makeApp(), "part-1", tx);

    expect(result).toBe(false);
    expect(mockLog.warn).toHaveBeenCalled();
  });
});
