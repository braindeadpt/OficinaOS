import type { PrismaClient } from "@generated/client";
import { AuditAction, type JobStatus } from "@generated/client";
import type { FaultCategory } from "@generated/enums";
import { Role } from "@shared/constants/roles";
import type { Scope } from "@shared/types/dashboard";
import type {
  InsightsReportDTO,
  OperationsReportDTO,
  ReturnsReportDTO,
  RevenueReportDTO,
  TimeRangePreset,
  TtrBucket,
} from "@shared/types/reports";
import {
  aggregateJobDeposits,
  aggregateJobRevenue,
  aggregateOutstandingJobs,
  countJobs,
  countJobsSimple,
  countReturnClaims,
  findAuditLogsForStatus,
  findCustomersByIds,
  findRevenueBreakdown,
  findTurnaroundJobs,
  groupJobRepairs,
  groupJobsByCustomer,
  groupJobsByCustomerWithMinDate,
  groupJobsByStatus,
  groupTopCustomersByRevenue,
  queryRawProfitMargin,
} from "../repositories/report.repository.js";
import type { DbClient } from "../repositories/types.js";
import type { DateRange } from "../utils/time-range.js";
import { monthRange, todayRange, toMoney } from "../utils/time-range.js";

function scopeWhere(scope: Scope) {
  return scope.role === Role.TECHNICIAN ? { technicianId: scope.userId } : {};
}

export function resolveRange(
  preset: TimeRangePreset | undefined,
  from: string | undefined,
  to: string | undefined,
  shopTz: string,
  now: Date = new Date()
): DateRange {
  if (from && to) {
    return { start: new Date(from), end: new Date(to) };
  }
  switch (preset) {
    case "7d": {
      const start = new Date(now.getTime() - 7 * 86_400_000);
      return { start, end: now };
    }
    case "30d": {
      const start = new Date(now.getTime() - 30 * 86_400_000);
      return { start, end: now };
    }
    case "month":
      return monthRange(shopTz, now);
    case "year": {
      const today = todayRange(shopTz, now);
      const yearStart = new Date(today.start);
      yearStart.setMonth(0, 1);
      return { start: yearStart, end: today.end };
    }
    default:
      return monthRange(shopTz, now);
  }
}

function previousRange(range: DateRange): DateRange {
  const duration = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - duration),
    end: range.start,
  };
}

export async function revenueReport(
  prisma: PrismaClient,
  scope: Scope,
  range: DateRange,
  includeMargin: boolean
): Promise<RevenueReportDTO> {
  const prev = previousRange(range);
  const completedInWindow = {
    action: AuditAction.STATUS_CHANGED,
    toValue: { in: ["DONE", "DELIVERED"] },
    createdAt: { gte: range.start, lt: range.end },
  };
  const completedInPrevWindow = {
    action: AuditAction.STATUS_CHANGED,
    toValue: { in: ["DONE", "DELIVERED"] },
    createdAt: { gte: prev.start, lt: prev.end },
  };
  const scopeFilter = scopeWhere(scope);
  const db = prisma as unknown as DbClient;

  const [currentRevenue, depositSum, outstandingRows, prevRevenue] =
    await Promise.all([
      aggregateJobRevenue(prisma, {
        ...scopeFilter,
        status: { in: ["DONE", "DELIVERED"] as JobStatus[] },
        auditLogs: { some: completedInWindow },
      }),
      aggregateJobDeposits(db, {
        ...scopeFilter,
        createdAt: { gte: range.start, lt: range.end },
      }),
      aggregateOutstandingJobs(db, {
        ...scopeFilter,
        status: { in: ["DONE", "DELIVERED"] as JobStatus[] },
      }),
      aggregateJobRevenue(prisma, {
        ...scopeFilter,
        status: { in: ["DONE", "DELIVERED"] as JobStatus[] },
        auditLogs: { some: completedInPrevWindow },
      }),
    ]);

  const totalRevenue = toMoney(Number(currentRevenue[0]?.revenue ?? 0));
  const totalDeposits = toMoney(depositSum._sum.depositAmount);
  const prevTotalRevenue = toMoney(Number(prevRevenue[0]?.revenue ?? 0));

  const outstandingBalance = toMoney(Number(outstandingRows[0]?.balance ?? 0));
  const outstandingJobCount = Number(outstandingRows[0]?.count ?? 0);

  const revenueChangePercent =
    prevTotalRevenue > 0
      ? Math.round(
          ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 10_000
        ) / 100
      : undefined;

  let avgProfitMargin: number | undefined;
  if (includeMargin) {
    const costRows = await queryRawProfitMargin(
      prisma,
      range.start,
      range.end,
      scope.role === Role.TECHNICIAN,
      scope.role === Role.TECHNICIAN ? scope.userId : undefined
    );
    const cost = toMoney(Number(costRows[0]?.cost ?? 0));
    avgProfitMargin =
      totalRevenue > 0
        ? Math.round(((totalRevenue - cost) / totalRevenue) * 10_000) / 100
        : 0;
  }

  const breakdownRows = await findRevenueBreakdown(db, {
    ...scopeFilter,
    status: { in: ["DONE", "DELIVERED"] as JobStatus[] },
    auditLogs: { some: completedInWindow },
  });

  const breakdown = breakdownRows.map((j) => {
    const partsCost = toMoney(
      j.partsUsed.reduce((s, p) => s + toMoney(p.totalCost), 0)
    );
    const repairsTotal = toMoney(
      j.repairs.reduce((s, r) => s + toMoney(r.price), 0)
    );
    const row: RevenueReportDTO["breakdown"][number] = {
      jobCode: j.jobCode,
      customerName: j.customer.name,
      deviceName: `${j.device.brand.name} ${j.device.model}`,
      estimatedCost: toMoney(j.estimatedCost),
      depositAmount: toMoney(j.depositAmount),
      partsCost,
      repairsTotal,
      completedAt:
        j.auditLogs[0]?.createdAt?.toISOString() ?? j.updatedAt.toISOString(),
    };
    if (includeMargin && repairsTotal > 0) {
      row.margin =
        Math.round(((repairsTotal - partsCost) / repairsTotal) * 10_000) / 100;
    }
    return row;
  });

  return {
    summary: {
      totalRevenue,
      totalDeposits,
      ...(includeMargin && { avgProfitMargin }),
      outstandingBalance,
      outstandingJobCount,
      revenueChangePercent,
    },
    breakdown,
  };
}

export async function operationsReport(
  prisma: PrismaClient,
  scope: Scope,
  range: DateRange,
  includeShopWide: boolean
): Promise<OperationsReportDTO> {
  const prev = previousRange(range);
  const scopeFilter = scopeWhere(scope);
  const completedStatuses: JobStatus[] = ["DONE", "DELIVERED"];
  const completedInWindow = {
    action: AuditAction.STATUS_CHANGED,
    toValue: { in: completedStatuses as string[] },
    createdAt: { gte: range.start, lt: range.end },
  };
  const completedInPrevWindow = {
    action: AuditAction.STATUS_CHANGED,
    toValue: { in: completedStatuses as string[] },
    createdAt: { gte: prev.start, lt: prev.end },
  };
  const db = prisma as unknown as DbClient;

  const [jobsCompleted, prevCompleted, inProgressJobs, turnaroundRows] =
    await Promise.all([
      countJobs(db, {
        ...scopeFilter,
        status: { in: completedStatuses },
        auditLogs: { some: completedInWindow },
      }),
      countJobs(db, {
        ...scopeFilter,
        status: { in: completedStatuses },
        auditLogs: { some: completedInPrevWindow },
      }),
      countJobs(db, {
        ...scopeFilter,
        status: { in: ["IN_REPAIR", "ON_HOLD"] as JobStatus[] },
      }),
      findTurnaroundJobs(db, {
        ...scopeFilter,
        status: { in: completedStatuses },
        auditLogs: { some: completedInWindow },
      }),
    ]);

  const jobsCompletedChangePercent =
    prevCompleted > 0
      ? Math.round(((jobsCompleted - prevCompleted) / prevCompleted) * 10_000) /
        100
      : undefined;

  let totalTurnaroundMs = 0;
  let turnaroundCount = 0;
  for (const row of turnaroundRows) {
    const completionTime = row.auditLogs[0]?.createdAt?.getTime();
    if (completionTime) {
      totalTurnaroundMs += completionTime - row.createdAt.getTime();
      turnaroundCount++;
    }
  }
  const avgTurnaroundHours =
    turnaroundCount > 0
      ? Math.round((totalTurnaroundMs / turnaroundCount / 3_600_000) * 10) / 10
      : 0;

  let warrantyReturnRate: number | undefined;
  if (includeShopWide) {
    const claimFilter = {
      openedAt: { gte: range.start, lt: range.end },
    };
    const [claimCount, totalCount] = await Promise.all([
      countReturnClaims(db, claimFilter),
      countJobs(db, {
        status: { in: completedStatuses },
        auditLogs: { some: completedInWindow },
      }),
    ]);
    warrantyReturnRate =
      totalCount > 0 ? Math.round((claimCount / totalCount) * 10_000) / 100 : 0;
  }

  const topRepairsRaw = await groupJobRepairs(db, {
    job: {
      ...scopeFilter,
      status: { in: completedStatuses },
      auditLogs: { some: completedInWindow },
    },
  });

  const topRepairs = topRepairsRaw
    .map((r) => ({
      repairName: r.repairName,
      category: r.category ?? "",
      count: typeof r._count === "object" ? (r._count._all ?? 0) : 0,
      avgPrice: toMoney(r._avg?.price),
      revenue: toMoney(r._sum?.price),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const allStatusEntries = await findAuditLogsForStatus(
    db,
    {
      action: AuditAction.STATUS_CHANGED,
      toValue: { in: completedStatuses as string[] },
      createdAt: { gte: range.start, lt: range.end },
      job: { ...scopeFilter },
    },
    2000
  );

  const statusGroups = await groupJobsByStatus(db, {
    ...scopeFilter,
    auditLogs: { some: completedInWindow },
  });

  const daysByStatus = new Map<string, { totalDays: number; count: number }>();
  for (const entry of allStatusEntries) {
    if (!entry.job) {
      continue;
    }
    const status = entry.toValue ?? "";
    const days = Math.max(
      0,
      (entry.createdAt.getTime() - entry.job.createdAt.getTime()) / 86_400_000
    );
    const existing = daysByStatus.get(status) ?? { totalDays: 0, count: 0 };
    existing.totalDays += days;
    existing.count++;
    daysByStatus.set(status, existing);
  }

  const statusBreakdown: OperationsReportDTO["statusBreakdown"] = statusGroups
    .map((g) => {
      const status = g.status;
      const avgInfo = daysByStatus.get(status);
      return {
        status,
        count: typeof g._count === "object" ? (g._count._all ?? 0) : 0,
        avgDays: avgInfo
          ? Math.round((avgInfo.totalDays / avgInfo.count) * 10) / 10
          : 0,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    summary: {
      jobsCompleted,
      jobsCompletedChangePercent,
      avgTurnaroundHours,
      jobsInProgress: inProgressJobs,
      ...(includeShopWide && { warrantyReturnRate }),
    },
    topRepairs,
    statusBreakdown,
  };
}

export async function insightsReport(
  prisma: PrismaClient,
  scope: Scope,
  range: DateRange
): Promise<InsightsReportDTO> {
  const baseWhere = {
    ...scopeWhere(scope),
    createdAt: { gte: range.start, lt: range.end },
  };
  const db = prisma as unknown as DbClient;

  const [customerJobGroups, newCustomerIds, totalJobs, topCustomersRaw] =
    await Promise.all([
      groupJobsByCustomer(db, baseWhere),
      groupJobsByCustomerWithMinDate(db, baseWhere),
      countJobsSimple(db, baseWhere),
      groupTopCustomersByRevenue(db, baseWhere),
    ]);

  let newCount = 0;
  let returningCount = 0;
  for (const g of newCustomerIds) {
    const earliestJob = g._min.createdAt;
    if (earliestJob && earliestJob >= range.start && earliestJob < range.end) {
      newCount++;
    } else {
      returningCount++;
    }
  }

  const totalCustomers = customerJobGroups.length;
  const repeatRate =
    totalCustomers > 0
      ? Math.round(
          (customerJobGroups.filter((g) => g._count._all >= 2).length /
            totalCustomers) *
            10_000
        ) / 100
      : 0;
  const avgSpendPerVisit =
    totalJobs > 0
      ? toMoney(
          customerJobGroups.reduce(
            (s, g) => s + toMoney(g._sum.estimatedCost),
            0
          ) / totalJobs
        )
      : 0;

  const topCustomerIds = topCustomersRaw.map((g) => g.customerId);
  const customers = await findCustomersByIds(db, topCustomerIds);
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const topCustomers = topCustomersRaw.map((g) => {
    const c = customerMap.get(g.customerId);
    return {
      customerId: g.customerId,
      customerName: c?.name ?? "\u2014",
      phone: c?.phone ?? "",
      totalJobs: g._count._all,
      totalRevenue: toMoney(g._sum.estimatedCost),
      lastVisit: g._max.createdAt?.toISOString() ?? "",
      avgSpend:
        g._count._all > 0
          ? toMoney(toMoney(g._sum.estimatedCost) / g._count._all)
          : 0,
    };
  });

  return {
    summary: {
      totalCustomers,
      newCustomers: newCount,
      returningCustomers: returningCount,
      repeatRate,
      avgSpendPerVisit,
      totalJobs,
    },
    topCustomers,
  };
}

function changePercent(current: number, previous: number): number | undefined {
  if (previous === 0) {
    return;
  }
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

const TTR_BUCKET_MAP: Record<string, TtrBucket> = {
  "0-7d": "0-7d",
  "8-30d": "8-30d",
  "31-60d": "31-60d",
  "61-90d": "61-90d",
  "90d+": "90d+",
};

function ttrBucket(days: number): TtrBucket {
  if (days <= 7) {
    return "0-7d";
  }
  if (days <= 30) {
    return "8-30d";
  }
  if (days <= 60) {
    return "31-60d";
  }
  if (days <= 90) {
    return "61-90d";
  }
  return "90d+";
}

async function computeShopWideReturnsMetrics(
  db: DbClient,
  range: DateRange,
  prev: DateRange,
  claimRangeFilter: Record<string, unknown>,
  claimPrevFilter: Record<string, unknown>,
  totalReturns: number,
  prevTotalReturns: number
): Promise<{
  warrantyReturnRate: number;
  warrantyReturnRateChangePercent: number | undefined;
  netWarrantyCost: number;
  netWarrantyCostChangePercent: number | undefined;
}> {
  const completedStatuses: JobStatus[] = ["DONE", "DELIVERED"];
  const completedInWindow = {
    action: AuditAction.STATUS_CHANGED,
    toValue: { in: completedStatuses as string[] },
    createdAt: { gte: range.start, lt: range.end },
  };
  const completedInPrevWindow = {
    action: AuditAction.STATUS_CHANGED,
    toValue: { in: completedStatuses as string[] },
    createdAt: { gte: prev.start, lt: prev.end },
  };

  const [deliveredJobs, prevDeliveredJobs] = await Promise.all([
    countJobs(db, {
      status: { in: completedStatuses },
      auditLogs: { some: completedInWindow },
    }),
    countJobs(db, {
      status: { in: completedStatuses },
      auditLogs: { some: completedInPrevWindow },
    }),
  ]);

  const warrantyReturnRate =
    deliveredJobs > 0
      ? Math.round((totalReturns / deliveredJobs) * 10_000) / 100
      : 0;

  const prevWarrantyReturnRate =
    prevDeliveredJobs > 0
      ? Math.round((prevTotalReturns / prevDeliveredJobs) * 10_000) / 100
      : 0;

  const warrantyReturnRateChangePercent = changePercent(
    warrantyReturnRate,
    prevWarrantyReturnRate
  );

  const [refundAgg, prevRefundAgg, reworkPartsAgg, prevReworkPartsAgg] =
    await Promise.all([
      db.returnClaim.aggregate({
        _sum: { refundAmount: true, partialChargeAmount: true },
        where: claimRangeFilter,
      }),
      db.returnClaim.aggregate({
        _sum: { refundAmount: true, partialChargeAmount: true },
        where: claimPrevFilter,
      }),
      db.jobPart.aggregate({
        _sum: { totalCost: true },
        where: {
          job: {
            isWarrantyReturn: true,
            auditLogs: { some: completedInWindow },
          },
        },
      }),
      db.jobPart.aggregate({
        _sum: { totalCost: true },
        where: {
          job: {
            isWarrantyReturn: true,
            auditLogs: { some: completedInPrevWindow },
          },
        },
      }),
    ]);

  const rawCost =
    toMoney(Number(refundAgg._sum.refundAmount ?? 0)) +
    toMoney(Number(reworkPartsAgg._sum.totalCost ?? 0)) -
    toMoney(Number(refundAgg._sum.partialChargeAmount ?? 0));
  const netWarrantyCost = toMoney(rawCost);

  const prevRawCost =
    toMoney(Number(prevRefundAgg._sum.refundAmount ?? 0)) +
    toMoney(Number(prevReworkPartsAgg._sum.totalCost ?? 0)) -
    toMoney(Number(prevRefundAgg._sum.partialChargeAmount ?? 0));
  const prevNetWarrantyCost = toMoney(prevRawCost);
  const netWarrantyCostChangePercent = changePercent(
    netWarrantyCost,
    prevNetWarrantyCost
  );

  return {
    warrantyReturnRate,
    warrantyReturnRateChangePercent,
    netWarrantyCost,
    netWarrantyCostChangePercent,
  };
}

interface TtrResult {
  avgDays: number;
  buckets: Record<TtrBucket, number>;
  prevAvgDays: number;
}

async function computeTimeToReturn(
  db: DbClient,
  claimRangeFilter: Record<string, unknown>,
  claimPrevFilter: Record<string, unknown>
): Promise<TtrResult> {
  const [claimsWithDelivery, prevClaimsWithDelivery] = await Promise.all([
    db.returnClaim.findMany({
      where: claimRangeFilter,
      select: {
        openedAt: true,
        originalJob: {
          select: {
            auditLogs: {
              where: {
                action: "STATUS_CHANGED" as AuditAction,
                toValue: { in: ["DELIVERED"] },
              },
              select: { createdAt: true },
              orderBy: { createdAt: "desc" as const },
              take: 1,
            },
          },
        },
      },
    }),
    db.returnClaim.findMany({
      where: claimPrevFilter,
      select: {
        openedAt: true,
        originalJob: {
          select: {
            auditLogs: {
              where: {
                action: "STATUS_CHANGED" as AuditAction,
                toValue: { in: ["DELIVERED"] },
              },
              select: { createdAt: true },
              orderBy: { createdAt: "desc" as const },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  let totalTimeToReturn = 0;
  let timeToReturnCount = 0;
  const ttrBuckets: Record<TtrBucket, number> = {
    "0-7d": 0,
    "8-30d": 0,
    "31-60d": 0,
    "61-90d": 0,
    "90d+": 0,
  };

  for (const claim of claimsWithDelivery) {
    const deliveryDate = claim.originalJob.auditLogs[0]?.createdAt;
    if (deliveryDate) {
      const rawDays =
        (claim.openedAt.getTime() - deliveryDate.getTime()) / 86_400_000;
      const days = Math.max(0, rawDays);
      totalTimeToReturn += days;
      timeToReturnCount++;
      ttrBuckets[ttrBucket(days)]++;
    }
  }

  let prevTotalTimeToReturn = 0;
  let prevTimeToReturnCount = 0;
  for (const claim of prevClaimsWithDelivery) {
    const deliveryDate = claim.originalJob.auditLogs[0]?.createdAt;
    if (deliveryDate) {
      const rawDays =
        (claim.openedAt.getTime() - deliveryDate.getTime()) / 86_400_000;
      prevTotalTimeToReturn += Math.max(0, rawDays);
      prevTimeToReturnCount++;
    }
  }

  const avgDays =
    timeToReturnCount > 0
      ? Math.round((totalTimeToReturn / timeToReturnCount) * 10) / 10
      : 0;

  const prevAvgDays =
    prevTimeToReturnCount > 0
      ? Math.round((prevTotalTimeToReturn / prevTimeToReturnCount) * 10) / 10
      : 0;

  return { avgDays, prevAvgDays, buckets: ttrBuckets };
}

async function computeByRepairType(
  db: DbClient,
  claimRangeFilter: Record<string, unknown>
): Promise<ReturnsReportDTO["byRepairType"]> {
  const repairFaultRows = await db.returnClaim.groupBy({
    by: ["claimedJobRepairId", "faultCategory"],
    where: {
      ...claimRangeFilter,
      claimedJobRepairId: { not: null },
      faultCategory: { not: null },
    },
    _count: { _all: true },
  });

  const repairMap = new Map<
    string,
    { repairName: string; count: number; faults: Map<FaultCategory, number> }
  >();
  const repairIds = new Set(
    repairFaultRows.map((r) => r.claimedJobRepairId).filter(Boolean) as string[]
  );

  if (repairIds.size > 0) {
    const repairs = await db.jobRepair.findMany({
      where: { id: { in: [...repairIds] } },
      select: { id: true, repairName: true },
    });
    const repairNameMap = new Map(repairs.map((r) => [r.id, r.repairName]));

    for (const row of repairFaultRows) {
      const id = row.claimedJobRepairId as string;
      const name = repairNameMap.get(id) ?? "Unknown";
      const fault = row.faultCategory as FaultCategory;
      const cnt = typeof row._count === "object" ? (row._count._all ?? 0) : 0;

      let entry = repairMap.get(id);
      if (!entry) {
        entry = { repairName: name, count: 0, faults: new Map() };
        repairMap.set(id, entry);
      }
      entry.count += cnt;
      entry.faults.set(fault, cnt);
    }
  }

  return [...repairMap.values()]
    .map((r) => ({
      repairName: r.repairName,
      count: r.count,
      faults: [...r.faults.entries()].map(([faultCategory, count]) => ({
        faultCategory,
        count,
      })),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function returnsReport(
  prisma: PrismaClient,
  scope: Scope,
  range: DateRange
): Promise<ReturnsReportDTO> {
  const prev = previousRange(range);
  const db = prisma as unknown as DbClient;
  const includeShopWide = scope.role !== Role.TECHNICIAN;

  const claimRangeFilter = { openedAt: { gte: range.start, lt: range.end } };
  const claimPrevFilter = { openedAt: { gte: prev.start, lt: prev.end } };

  const [totalReturns, prevTotalReturns] = await Promise.all([
    countReturnClaims(db, claimRangeFilter),
    countReturnClaims(db, claimPrevFilter),
  ]);

  let warrantyReturnRate: number | undefined;
  let warrantyReturnRateChangePercent: number | undefined;
  let netWarrantyCost = 0;
  let netWarrantyCostChangePercent: number | undefined;

  if (includeShopWide) {
    const shopMetrics = await computeShopWideReturnsMetrics(
      db,
      range,
      prev,
      claimRangeFilter,
      claimPrevFilter,
      totalReturns,
      prevTotalReturns
    );
    warrantyReturnRate = shopMetrics.warrantyReturnRate;
    warrantyReturnRateChangePercent =
      shopMetrics.warrantyReturnRateChangePercent;
    netWarrantyCost = shopMetrics.netWarrantyCost;
    netWarrantyCostChangePercent = shopMetrics.netWarrantyCostChangePercent;
  }

  const ttr = await computeTimeToReturn(db, claimRangeFilter, claimPrevFilter);
  const avgTimeToReturnChangePercent = changePercent(
    ttr.avgDays,
    ttr.prevAvgDays
  );

  const faultRows = await db.returnClaim.groupBy({
    by: ["faultCategory"],
    where: { ...claimRangeFilter, faultCategory: { not: null } },
    _count: { _all: true },
  });

  const byFaultCategory = faultRows
    .filter((r) => r.faultCategory !== null)
    .map((r) => ({
      faultCategory: r.faultCategory as FaultCategory,
      count: typeof r._count === "object" ? (r._count._all ?? 0) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const [byRepairType, byTechnician]: [
    ReturnsReportDTO["byRepairType"],
    ReturnsReportDTO["byTechnician"],
  ] = includeShopWide
    ? [await computeByRepairType(db, claimRangeFilter), []]
    : [[], []];

  const ttrDistribution: ReturnsReportDTO["ttrDistribution"] = (
    Object.keys(TTR_BUCKET_MAP) as TtrBucket[]
  ).map((bucket) => ({
    bucket,
    count: ttr.buckets[bucket],
  }));

  return {
    byFaultCategory,
    byRepairType,
    byTechnician,
    summary: {
      avgTimeToReturnChangePercent,
      avgTimeToReturnDays: ttr.avgDays,
      netWarrantyCost,
      netWarrantyCostChangePercent,
      totalReturns,
      totalReturnsChangePercent: changePercent(totalReturns, prevTotalReturns),
      warrantyReturnRate,
      warrantyReturnRateChangePercent,
    },
    ttrDistribution,
  };
}
