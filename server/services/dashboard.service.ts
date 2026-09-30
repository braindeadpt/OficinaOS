import { type AuditAction, Prisma } from "@generated/client";
import type { JobStatusType } from "@shared/constants/job-statuses";
import { JobStatus } from "@shared/constants/job-statuses";
import { Role } from "@shared/constants/roles";
import type {
  ActiveRepairDTO,
  ActivityItemDTO,
  FinancialTrendPoint,
  KanbanJobDTO,
  OverdueJobDTO,
  PickupReadyDTO,
  PriorityAlertDTO,
  RecentIntakeDTO,
  ScheduleItemDTO,
  Scope,
  WarrantyReturnDTO,
} from "@shared/types/dashboard";
import {
  auditLogFindMany,
  countWaitingForParts,
  findActiveRepairs,
  findDeliveredJobs,
  findKanbanJobs,
  findLowStockParts,
  findOverdueJobs,
  findPickupReady,
  findRepairTimeJobs,
  findScheduledForTech,
  findTodayIntakes,
  findWarrantyReturns,
  jobCount,
  jobGroupByStatus,
  queryFinancialTrend,
  queryRevenueAndCost,
} from "../repositories/dashboard.repository.js";
import type { DbClient } from "../repositories/types.js";
import type { DateRange } from "../utils/time-range.js";
import { toMoney } from "../utils/time-range.js";

const ALL_STATUSES: JobStatusType[] = [
  JobStatus.CANCELLED,
  JobStatus.DELIVERED,
  JobStatus.DONE,
  JobStatus.IN_REPAIR,
  JobStatus.INTAKE,
  JobStatus.ON_HOLD,
  JobStatus.RETURNED,
  JobStatus.WAITING_FOR_PARTS,
];

const DASHBOARD_ACTIVE_STATUSES: JobStatusType[] = [
  JobStatus.IN_REPAIR,
  JobStatus.INTAKE,
  JobStatus.ON_HOLD,
  JobStatus.WAITING_FOR_PARTS,
];

function scopeWhere(scope: Scope) {
  return scope.role === Role.TECHNICIAN ? { technicianId: scope.userId } : {};
}

export async function pipelineCounts(
  prisma: DbClient,
  scope: Scope
): Promise<Record<JobStatusType, number>> {
  const groups = await jobGroupByStatus(prisma, scopeWhere(scope));
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
    JobStatusType,
    number
  >;
  for (const g of groups) {
    counts[g.status] = g._count._all;
  }
  return counts;
}

export async function activeJobsCount(
  prisma: DbClient,
  scope: Scope
): Promise<number> {
  return await jobCount(prisma, {
    status: {
      in: [
        JobStatus.INTAKE,
        JobStatus.IN_REPAIR,
        JobStatus.ON_HOLD,
        JobStatus.WAITING_FOR_PARTS,
      ],
    },
    ...scopeWhere(scope),
  });
}

export async function completedTodayCount(
  prisma: DbClient,
  scope: Scope,
  today: DateRange
): Promise<number> {
  return await jobCount(prisma, {
    ...scopeWhere(scope),
    status: JobStatus.DELIVERED,
    updatedAt: { gte: today.start, lt: today.end },
  });
}

async function revenueAndCost(
  prisma: DbClient,
  scope: Scope,
  range: DateRange
): Promise<{ cost: number; revenue: number }> {
  const rows = await queryRevenueAndCost(
    prisma,
    range.start,
    range.end,
    scope.role === Role.TECHNICIAN
      ? Prisma.sql`AND j."technicianId" = ${scope.userId}`
      : Prisma.empty
  );
  let revenue = 0;
  let cost = 0;
  for (const r of rows) {
    revenue += Number(r.revenue);
    cost += Number(r.cost);
  }
  return { cost: toMoney(cost), revenue: toMoney(revenue) };
}

export async function revenueThisMonth(
  prisma: DbClient,
  scope: Scope,
  month: DateRange
): Promise<number> {
  const { revenue } = await revenueAndCost(prisma, scope, month);
  return revenue;
}

export async function avgProfitMargin(
  prisma: DbClient,
  scope: Scope,
  month: DateRange
): Promise<number> {
  const { cost, revenue } = await revenueAndCost(prisma, scope, month);
  if (revenue === 0) {
    return 0;
  }
  // Percent (e.g. 42.35), same unit as reports.service's avgProfitMargin.
  return Math.round(((revenue - cost) / revenue) * 10_000) / 100;
}

export async function revenueAndMarginComparison(
  prisma: DbClient,
  scope: Scope,
  currentMonth: DateRange,
  prevMonth: DateRange
): Promise<{
  avgProfitMarginChange: number;
  avgProfitMarginPrev: number;
  avgProfitMarginThis: number;
  revenueChangePct: number;
  revenuePrevMonth: number;
  revenueThisMonth: number;
}> {
  const [current, prev] = await Promise.all([
    revenueAndCost(prisma, scope, currentMonth),
    revenueAndCost(prisma, scope, prevMonth),
  ]);

  const revenueThisMonth = current.revenue;
  const revenuePrevMonth = prev.revenue;
  // Percent (e.g. 42.35), same unit as reports.service's avgProfitMargin.
  const avgProfitMarginThis =
    current.revenue === 0
      ? 0
      : Math.round(
          ((current.revenue - current.cost) / current.revenue) * 10_000
        ) / 100;
  const avgProfitMarginPrev =
    prev.revenue === 0
      ? 0
      : Math.round(((prev.revenue - prev.cost) / prev.revenue) * 10_000) / 100;

  let revenueChangePct: number;
  if (revenuePrevMonth === 0) {
    revenueChangePct = revenueThisMonth > 0 ? 100 : 0;
  } else {
    revenueChangePct = Math.round(
      ((revenueThisMonth - revenuePrevMonth) / revenuePrevMonth) * 100
    );
  }

  const avgProfitMarginChange = Math.round(
    avgProfitMarginThis - avgProfitMarginPrev
  );

  return {
    avgProfitMarginChange,
    avgProfitMarginPrev,
    avgProfitMarginThis,
    revenueChangePct,
    revenuePrevMonth,
    revenueThisMonth,
  };
}

export async function financialTrend(
  prisma: DbClient,
  scope: Scope,
  days: number
): Promise<FinancialTrendPoint[]> {
  const rows = await queryFinancialTrend(
    prisma,
    days,
    scope.shopTz,
    scope.role === Role.TECHNICIAN
      ? Prisma.sql`AND j."technicianId" = ${scope.userId}`
      : Prisma.empty
  );
  return rows.map((r) => ({
    cost: toMoney(Number(r.cost)),
    date: new Date(r.day).toISOString().slice(0, 10),
    revenue: toMoney(Number(r.revenue)),
  }));
}

export async function overdueJobs(
  prisma: DbClient,
  scope: Scope,
  limit: number
): Promise<OverdueJobDTO[]> {
  const jobs = await findOverdueJobs(
    prisma,
    {
      ...scopeWhere(scope),
      estimatedDate: { lt: new Date() },
      status: { in: [...DASHBOARD_ACTIVE_STATUSES] },
    },
    { estimatedDate: "asc" },
    limit
  );
  const now = Date.now();
  return jobs.map((j) => ({
    customerName: j.customer.name,
    device: `${j.device.brand.name} ${j.device.model}`,
    hoursLate: j.estimatedDate
      ? Math.max(0, Math.floor((now - j.estimatedDate.getTime()) / 3_600_000))
      : 0,
    id: j.id,
    jobCode: j.jobCode,
    repairSummary: j.repairs[0]?.repairName ?? "—",
  }));
}

export async function warrantyReturnsOpen(
  prisma: DbClient,
  scope: Scope,
  limit: number
): Promise<WarrantyReturnDTO[]> {
  const jobs = await findWarrantyReturns(
    prisma,
    {
      ...scopeWhere(scope),
      isWarrantyReturn: true,
      status: { notIn: [JobStatus.DELIVERED, JobStatus.CANCELLED] },
    },
    { createdAt: "desc" },
    limit
  );
  return jobs.map((j) => ({
    createdAt: j.createdAt.toISOString(),
    description: j.reportedProblem.slice(0, 80),
    id: j.id,
    jobCode: j.jobCode,
  }));
}

export async function todayScheduleForTech(
  prisma: DbClient,
  userId: string,
  today: DateRange
): Promise<ScheduleItemDTO[]> {
  const scheduled = await findScheduledForTech(
    prisma,
    {
      estimatedDate: { gte: today.start, lt: today.end },
      technicianId: userId,
    },
    { createdAt: "asc" },
    20
  );
  const source =
    scheduled.length > 0
      ? scheduled
      : await findScheduledForTech(
          prisma,
          {
            status: { in: [...DASHBOARD_ACTIVE_STATUSES] },
            technicianId: userId,
          },
          { createdAt: "asc" },
          5
        );
  return source.map((j) => ({
    customerName: j.customer.name,
    device: `${j.device.brand.name} ${j.device.model}`,
    estimatedDate: j.estimatedDate
      ? j.estimatedDate.toISOString().slice(0, 10)
      : null,
    id: j.id,
    jobCode: j.jobCode,
    repairSummary: j.repairs[0]?.repairName ?? "—",
    status: j.status,
  }));
}

export async function recentActivityForTech(
  prisma: DbClient,
  userId: string,
  limit: number
): Promise<ActivityItemDTO[]> {
  const rows = await auditLogFindMany(
    prisma,
    { OR: [{ job: { technicianId: userId } }, { userId }] },
    { job: { select: { jobCode: true } } },
    { createdAt: "desc" },
    limit
  );
  return rows.map((r) => ({
    action: r.action as AuditAction,
    createdAt: r.createdAt.toISOString(),
    fromValue: r.fromValue,
    id: r.id,
    jobCode: r.job?.jobCode ?? null,
    toValue: r.toValue,
  }));
}

async function calculateAvgRepairTime(
  prisma: DbClient,
  whereClause: Record<string, unknown>,
  days: number
): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await findRepairTimeJobs(prisma, {
    status: JobStatus.DELIVERED,
    updatedAt: { gte: since },
    ...whereClause,
  });
  if (rows.length === 0) {
    return 0;
  }
  const totalHours = rows.reduce(
    (sum, j) =>
      sum + (j.updatedAt.getTime() - j.createdAt.getTime()) / 3_600_000,
    0
  );
  return Math.round((totalHours / rows.length) * 10) / 10;
}

export async function avgRepairTimeHours(
  prisma: DbClient,
  userId: string,
  days: number
): Promise<number> {
  return await calculateAvgRepairTime(prisma, { technicianId: userId }, days);
}

export async function avgRepairTimeHoursShop(
  prisma: DbClient,
  scope: Scope,
  days: number
): Promise<number> {
  return await calculateAvgRepairTime(prisma, scopeWhere(scope), days);
}

export async function priorityActionsForTech(
  prisma: DbClient,
  userId: string
): Promise<{
  jobsNeedingStatusUpdate: number;
  overdueCount: number;
  partsWaitingCount: number;
}> {
  const staleThreshold = new Date(Date.now() - 24 * 3_600_000);
  const [stale, overdue, waiting] = await Promise.all([
    jobCount(prisma, {
      status: JobStatus.IN_REPAIR,
      technicianId: userId,
      updatedAt: { lt: staleThreshold },
    }),
    jobCount(prisma, {
      estimatedDate: { lt: new Date() },
      status: { in: [...DASHBOARD_ACTIVE_STATUSES] },
      technicianId: userId,
    }),
    jobCount(prisma, {
      status: JobStatus.WAITING_FOR_PARTS,
      technicianId: userId,
    }),
  ]);
  return {
    jobsNeedingStatusUpdate: stale,
    overdueCount: overdue,
    partsWaitingCount: waiting,
  };
}

export async function activeRepairsQueue(
  prisma: DbClient,
  scope: Scope,
  today: DateRange,
  limit: number
): Promise<ActiveRepairDTO[]> {
  const rows = await findActiveRepairs(
    prisma,
    {
      ...scopeWhere(scope),
      OR: [
        { status: { in: [...DASHBOARD_ACTIVE_STATUSES] } },
        {
          status: JobStatus.DELIVERED,
          updatedAt: { gte: today.start, lt: today.end },
        },
      ],
    },
    { updatedAt: "desc" },
    limit
  );
  return rows.map((j) => ({
    customerName: j.customer.name,
    deviceModel: `${j.device.brand.name} ${j.device.model}`,
    estimatedDate: j.estimatedDate
      ? j.estimatedDate.toISOString().slice(0, 10)
      : null,
    id: j.id,
    jobCode: j.jobCode,
    status: j.status,
    technicianName: j.technician?.name || j.technician?.username || null,
    updatedAt: j.updatedAt.toISOString(),
  }));
}

export async function todayOverview(
  prisma: DbClient,
  scope: Scope,
  today: DateRange
): Promise<{
  completedToday: number;
  recentIntakes: RecentIntakeDTO[];
  totalToday: number;
}> {
  const [totalToday, completedToday, intakes] = await Promise.all([
    jobCount(prisma, {
      ...scopeWhere(scope),
      createdAt: { gte: today.start, lt: today.end },
    }),
    jobCount(prisma, {
      ...scopeWhere(scope),
      status: JobStatus.DELIVERED,
      updatedAt: { gte: today.start, lt: today.end },
    }),
    findTodayIntakes(
      prisma,
      {
        ...scopeWhere(scope),
        createdAt: { gte: today.start, lt: today.end },
        status: JobStatus.INTAKE,
      },
      { createdAt: "desc" },
      3
    ),
  ]);
  return {
    completedToday,
    recentIntakes: intakes.map((j) => ({
      createdAt: j.createdAt.toISOString(),
      deviceModel: `${j.device.brand.name} ${j.device.model}`,
      id: j.id,
      jobCode: j.jobCode,
    })),
    totalToday,
  };
}

export async function pickupReady(
  prisma: DbClient,
  scope: Scope,
  limit: number
): Promise<PickupReadyDTO[]> {
  const rows = await findPickupReady(
    prisma,
    { ...scopeWhere(scope), status: JobStatus.DONE },
    { updatedAt: "desc" },
    limit
  );
  return rows.map((j) => ({
    customerName: j.customer.name,
    customerPhone: j.customer.phone,
    deviceModel: `${j.device.brand.name} ${j.device.model}`,
    id: j.id,
    jobCode: j.jobCode,
    readyAt: j.updatedAt.toISOString(),
  }));
}

export async function priorityAlerts(
  prisma: DbClient,
  scope: Scope,
  limit: number
): Promise<PriorityAlertDTO[]> {
  const [overdue, warranty, ready] = await Promise.all([
    findDeliveredJobs(
      prisma,
      {
        ...scopeWhere(scope),
        estimatedDate: { lt: new Date() },
        status: { in: [...DASHBOARD_ACTIVE_STATUSES] },
      },
      { id: true, jobCode: true, updatedAt: true },
      { updatedAt: "desc" },
      limit
    ),
    findDeliveredJobs(
      prisma,
      {
        ...scopeWhere(scope),
        isWarrantyReturn: true,
        status: { notIn: [JobStatus.DELIVERED, JobStatus.CANCELLED] },
      },
      {
        customer: { select: { name: true } },
        id: true,
        jobCode: true,
        updatedAt: true,
      },
      { updatedAt: "desc" },
      limit
    ),
    findDeliveredJobs(
      prisma,
      { ...scopeWhere(scope), status: JobStatus.DONE },
      {
        customer: { select: { name: true } },
        id: true,
        jobCode: true,
        updatedAt: true,
      },
      { updatedAt: "desc" },
      limit
    ),
  ]);
  const combined: Array<PriorityAlertDTO & { ts: number }> = [
    ...overdue.map((j) => ({
      customerName: null,
      id: `od-${j.id}`,
      jobCode: j.jobCode,
      kind: "OVERDUE" as const,
      ts: j.updatedAt.getTime(),
    })),
    ...warranty.map((j) => ({
      customerName: j.customer.name,
      id: `wr-${j.id}`,
      jobCode: j.jobCode,
      kind: "WARRANTY_RETURN" as const,
      ts: j.updatedAt.getTime(),
    })),
    ...ready.map((j) => ({
      customerName: j.customer.name,
      id: `rp-${j.id}`,
      jobCode: j.jobCode,
      kind: "READY_FOR_PICKUP" as const,
      ts: j.updatedAt.getTime(),
    })),
  ];
  combined.sort((a, b) => b.ts - a.ts);
  return combined.slice(0, limit).map(({ ts: _ts, ...rest }) => rest);
}

export async function waitingForPartsCount(
  prisma: DbClient,
  userId: string
): Promise<number> {
  return await countWaitingForParts(prisma, userId);
}

export async function partsAlertsForTech(
  prisma: DbClient,
  limit: number,
  _userId?: string
): Promise<
  Array<{
    id: string;
    name: string;
    stockQuantity: number;
    reorderLevel: number;
  }>
> {
  return await findLowStockParts(prisma, limit);
}

export async function getKanbanJobsForTech(
  prisma: DbClient,
  userId: string
): Promise<{ poolJobs: KanbanJobDTO[]; myJobs: KanbanJobDTO[] }> {
  const pool = await findKanbanJobs(prisma, {
    status: {
      in: [
        JobStatus.INTAKE,
        JobStatus.WAITING_FOR_PARTS,
        JobStatus.IN_REPAIR,
        JobStatus.ON_HOLD,
      ],
    },
    technicianId: null,
  });

  const my = await findKanbanJobs(prisma, {
    status: {
      in: [
        JobStatus.INTAKE,
        JobStatus.WAITING_FOR_PARTS,
        JobStatus.IN_REPAIR,
        JobStatus.ON_HOLD,
        JobStatus.DONE,
      ],
    },
    technicianId: userId,
  });

  const mapJob = (
    j: Awaited<ReturnType<typeof findKanbanJobs>>[number]
  ): KanbanJobDTO => ({
    id: j.id,
    jobCode: j.jobCode,
    customerName: j.customer?.name || "Unknown",
    device: j.device
      ? `${j.device.brand.name} ${j.device.model}`
      : "Unknown Device",
    reportedProblem: j.reportedProblem,
    status: j.status as JobStatusType,
    estimatedDate: j.estimatedDate ? j.estimatedDate.toISOString() : null,
    actualLaborHours: j.actualLaborHours ? Number(j.actualLaborHours) : null,
    holdReason: j.holdReason,
  });

  return {
    poolJobs: pool.map(mapJob),
    myJobs: my.map(mapJob),
  };
}
