import { describe, expect, it, vi } from "vitest";
import { cashReport } from "../cash-report.service.js";

function makePrisma() {
  return {
    payment: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    salePayment: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  } as unknown as any;
}

const ownerScope = { role: "OWNER", userId: "u1" } as any;
const techScope = { role: "TECHNICIAN", userId: "t1" } as any;

const NOW = new Date("2026-09-29T15:00:00Z");

const jobCreator = { id: "user-1", name: "Ana", username: "ana" };
const posCreator = { id: "user-2", name: "Bruno", username: "bruno" };

describe("cashReport", () => {
  it("aggregates job and POS payments by method", async () => {
    const prisma = makePrisma();
    (prisma.payment.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        method: "CASH",
        _count: { _all: 2 },
        _sum: { amount: 5000 },
      },
      {
        method: "CARD",
        _count: { _all: 1 },
        _sum: { amount: 2500.5 },
      },
    ]);
    (prisma.salePayment.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        method: "CASH",
        _count: { _all: 3 },
        _sum: { amount: 1500 },
      },
    ]);
    (prisma.payment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        amount: 3000,
        method: "CASH",
        createdBy: jobCreator,
      },
      {
        amount: 2500.5,
        method: "CARD",
        createdBy: jobCreator,
      },
    ]);
    (prisma.salePayment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      [
        {
          amount: 1500,
          method: "CASH",
          sale: { createdBy: posCreator },
        },
      ]
    );

    const result = await cashReport(prisma, ownerScope, "UTC", NOW);

    expect(result.byMethod).toEqual([
      { amount: 6500, count: 5, method: "CASH" },
      { amount: 2500.5, count: 1, method: "CARD" },
    ]);
    expect(result.summary.totalCollected).toBe(9000.5);
    expect(result.summary.cashTotal).toBe(6500);
    expect(result.summary.transferTotal).toBe(2500.5);
    expect(result.summary.paymentCount).toBe(6);
    expect(result.summary.userCount).toBe(2);
  });

  it("breaks down collections per user across job and POS payments", async () => {
    const prisma = makePrisma();
    (prisma.payment.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.salePayment.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
    (prisma.payment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        amount: 2000,
        method: "CASH",
        createdBy: jobCreator,
      },
      {
        amount: 1000,
        method: "CARD",
        createdBy: jobCreator,
      },
    ]);
    (prisma.salePayment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      [
        {
          amount: 4000,
          method: "CASH",
          sale: { createdBy: posCreator },
        },
        {
          amount: 500,
          method: "OTHER",
          sale: { createdBy: posCreator },
        },
      ]
    );

    const result = await cashReport(prisma, ownerScope, "UTC", NOW);

    expect(result.byUser).toEqual([
      { count: 2, name: "Bruno", total: 4500 },
      { count: 2, name: "Ana", total: 3000 },
    ]);
    expect(result.largestPayment).toEqual({
      amount: 4000,
      location: "POS",
      method: "CASH",
      userName: "Bruno",
    });
  });

  it("buckets the report to the shop-local current day", async () => {
    const prisma = makePrisma();
    (prisma.payment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await cashReport(prisma, ownerScope, "UTC", NOW);

    const where = (prisma.payment.groupBy as ReturnType<typeof vi.fn>).mock
      .calls[0][0].where;
    expect(new Date(where.createdAt.gte).toISOString()).toBe(
      "2026-09-29T00:00:00.000Z"
    );
  });

  it("scopes technician rows to their own collections", async () => {
    const prisma = makePrisma();
    (prisma.payment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await cashReport(prisma, techScope, "UTC", NOW);

    const jobWhere = (prisma.payment.groupBy as ReturnType<typeof vi.fn>).mock
      .calls[0][0].where;
    const saleWhere = (prisma.salePayment.groupBy as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].where.sale;
    expect(jobWhere.createdById).toBe("t1");
    expect(saleWhere.createdById).toBe("t1");
  });

  it("returns an empty report when nothing was collected today", async () => {
    const prisma = makePrisma();

    const result = await cashReport(prisma, ownerScope, "UTC", NOW);

    expect(result.byMethod).toEqual([]);
    expect(result.byUser).toEqual([]);
    expect(result.largestPayment).toBeNull();
    expect(result.summary.totalCollected).toBe(0);
    expect(result.summary.userCount).toBe(0);
  });
});
