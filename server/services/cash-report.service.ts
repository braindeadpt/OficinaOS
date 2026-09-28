import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants/roles";
import type { Scope } from "@shared/types/dashboard";
import type { CashReportDTO } from "@shared/types/reports";
import type { DbClient } from "../repositories/types.js";
import { todayRange, toMoney } from "../utils/time-range.js";

interface CreatorInfo {
  id: string;
  name: string;
  username: string;
}

interface RawPayment {
  amount: unknown;
  creator: CreatorInfo;
  location: "JOB" | "POS";
  method: string;
}

function creatorName(u: CreatorInfo): string {
  return u.name || u.username;
}

/**
 * Daily cash-up report for the shop's local timezone, covering both job
 * payments (repairs) and POS sale payments (accessories). Sale payments
 * inherit their collector from the parent sale; job payments carry their
 * own createdBy. Technician scope reduces the report to the caller's own
 * collections.
 */
export async function cashReport(
  prisma: PrismaClient,
  scope: Scope,
  shopTz: string,
  now: Date = new Date()
): Promise<CashReportDTO> {
  const range = todayRange(shopTz, now);
  const db = prisma as unknown as DbClient;
  const rangeFilter = { gte: range.start, lt: range.end };
  const isTechnician = scope.role === Role.TECHNICIAN;

  const jobWhere = {
    createdAt: rangeFilter,
    ...(isTechnician ? { createdById: scope.userId } : {}),
  };
  const saleWhere = {
    createdAt: rangeFilter,
    ...(isTechnician ? { createdById: scope.userId } : {}),
  };

  const [jobMethodAgg, saleMethodAgg, jobPaymentRows, salePaymentRows] =
    await Promise.all([
      db.payment.groupBy({
        by: ["method"],
        where: jobWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.salePayment.groupBy({
        by: ["method"],
        where: { sale: saleWhere },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.payment.findMany({
        where: jobWhere,
        select: {
          amount: true,
          method: true,
          createdBy: { select: { id: true, name: true, username: true } },
        },
      }),
      db.salePayment.findMany({
        where: { sale: saleWhere },
        select: {
          amount: true,
          method: true,
          sale: {
            select: {
              createdBy: { select: { id: true, name: true, username: true } },
            },
          },
        },
      }),
    ]);

  const rows: RawPayment[] = [
    ...jobPaymentRows.map((p) => ({
      amount: p.amount,
      creator: p.createdBy,
      location: "JOB" as const,
      method: p.method,
    })),
    ...salePaymentRows.map((p) => ({
      amount: p.amount,
      creator: p.sale.createdBy,
      location: "POS" as const,
      method: p.method,
    })),
  ];

  const methodTotals = new Map<string, { amount: number; count: number }>();
  for (const agg of [...jobMethodAgg, ...saleMethodAgg]) {
    const entry = methodTotals.get(agg.method) ?? { amount: 0, count: 0 };
    entry.amount = toMoney(
      entry.amount + toMoney(Number(agg._sum.amount ?? 0))
    );
    entry.count += agg._count._all;
    methodTotals.set(agg.method, entry);
  }
  const byMethod = [...methodTotals.entries()]
    .map(([method, t]) => ({ amount: t.amount, count: t.count, method }))
    .sort((a, b) => b.amount - a.amount);

  const perUser = new Map<
    string,
    { count: number; name: string; total: number }
  >();
  for (const row of rows) {
    const entry = perUser.get(row.creator.id) ?? {
      count: 0,
      name: creatorName(row.creator),
      total: 0,
    };
    entry.count += 1;
    entry.total = toMoney(entry.total + toMoney(Number(row.amount)));
    perUser.set(row.creator.id, entry);
  }
  const byUser = [...perUser.values()]
    .map((u) => ({ count: u.count, name: u.name, total: u.total }))
    .sort((a, b) => b.total - a.total);

  let largest: RawPayment | null = null;
  for (const row of rows) {
    if (
      !largest ||
      toMoney(Number(row.amount)) > toMoney(Number(largest.amount))
    ) {
      largest = row;
    }
  }

  const totalCollected = toMoney(byMethod.reduce((s, m) => s + m.amount, 0));
  const paymentCount = byMethod.reduce((s, m) => s + m.count, 0);
  const cashTotal = toMoney(
    byMethod
      .filter((m) => m.method === "CASH")
      .reduce((s, m) => s + m.amount, 0)
  );
  const transferTotal = toMoney(
    byMethod
      .filter((m) => m.method !== "CASH")
      .reduce((s, m) => s + m.amount, 0)
  );

  return {
    date: range.start.toISOString(),
    byMethod,
    byUser,
    largestPayment: largest && {
      amount: toMoney(Number(largest.amount)),
      location: largest.location,
      method: largest.method,
      userName: creatorName(largest.creator),
    },
    summary: {
      cashTotal,
      paymentCount,
      totalCollected,
      transferTotal,
      userCount: byUser.length,
    },
  };
}
