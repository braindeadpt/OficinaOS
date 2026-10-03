import { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

export function jobGroupByStatus(
  prisma: DbClient,
  where: Prisma.JobWhereInput
) {
  return prisma.job.groupBy({
    by: ["status"],
    _count: { _all: true },
    where,
  });
}

export function jobCount(prisma: DbClient, where: Prisma.JobWhereInput) {
  return prisma.job.count({ where });
}

export function findOverdueJobs(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      device: { select: { model: true, brand: { select: { name: true } } } },
      repairs: { take: 1, select: { repairName: true } },
    },
    orderBy,
    take,
  });
}

export function findWarrantyReturns(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({
    where,
    select: {
      createdAt: true,
      id: true,
      jobCode: true,
      reportedProblem: true,
    },
    orderBy,
    take,
  });
}

export function findScheduledForTech(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      device: { select: { model: true, brand: { select: { name: true } } } },
      repairs: { take: 1, select: { repairName: true } },
    },
    orderBy,
    take,
  });
}

export function findDeliveredJobs(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  select: Prisma.JobSelect,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({ where, select, orderBy, take });
}

export function findActiveRepairs(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      device: { select: { model: true, brand: { select: { name: true } } } },
      technician: { select: { name: true, username: true } },
    },
    orderBy,
    take,
  });
}

export function findTodayIntakes(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({
    where,
    include: {
      device: { select: { model: true, brand: { select: { name: true } } } },
    },
    orderBy,
    take,
  });
}

export function findPickupReady(
  prisma: DbClient,
  where: Prisma.JobWhereInput,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number
) {
  return prisma.job.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      device: { select: { model: true, brand: { select: { name: true } } } },
    },
    orderBy,
    take,
  });
}

interface RevCostRow {
  cost: string;
  revenue: string;
}

export function queryRevenueAndCost(
  prisma: DbClient,
  rangeStart: Date,
  rangeEnd: Date,
  technicianCond: Prisma.Sql | typeof Prisma.empty
) {
  // Revenue is attributed to the actual DELIVERED transition (latest
  // STATUS_CHANGED → DELIVERED audit row), not updatedAt — a note added
  // months later must not move revenue into the current period. Jobs
  // delivered before audit logging existed fall back to updatedAt.
  return prisma.$queryRaw<RevCostRow[]>(
    Prisma.sql`SELECT
        COALESCE(SUM(rt.total), 0) + COALESCE(SUM(pt.total), 0) AS revenue,
        COALESCE(SUM(pt.total), 0) AS cost
      FROM "jobs" j
      LEFT JOIN (SELECT "jobId", SUM("price") AS total FROM "job_repairs" GROUP BY "jobId") rt
        ON rt."jobId" = j."id"
      LEFT JOIN (SELECT "jobId", SUM("totalCost") AS total FROM "job_parts" GROUP BY "jobId") pt
        ON pt."jobId" = j."id"
      LEFT JOIN (SELECT "jobId", MAX("createdAt") AS delivered_at
                 FROM "audit_logs"
                 WHERE "action" = 'STATUS_CHANGED' AND "toValue" = 'DELIVERED'
                 GROUP BY "jobId") d
        ON d."jobId" = j."id"
      WHERE j."status" = 'DELIVERED'
        AND COALESCE(d.delivered_at, j."updatedAt") >= ${rangeStart}
        AND COALESCE(d.delivered_at, j."updatedAt") < ${rangeEnd}
        ${technicianCond}`
  );
}

interface FinancialTrendRow {
  cost: string;
  day: Date;
  revenue: string;
}

export function queryFinancialTrend(
  prisma: DbClient,
  days: number,
  shopTz: string,
  technicianCond: Prisma.Sql | typeof Prisma.empty
) {
  return prisma.$queryRaw<FinancialTrendRow[]>(
    Prisma.sql`WITH series AS (
       SELECT generate_series(
         (date_trunc('day', now() AT TIME ZONE ${shopTz}) - INTERVAL '1 day' * ${days - 1})::date,
         (date_trunc('day', now() AT TIME ZONE ${shopTz}))::date,
         '1 day'::interval
       )::date AS day
     ),
     repair_totals AS (
       SELECT "jobId", SUM("price") AS total FROM "job_repairs" GROUP BY "jobId"
     ),
     parts_totals AS (
       SELECT "jobId", SUM("totalCost") AS total FROM "job_parts" GROUP BY "jobId"
     )
     SELECT s.day,
       COALESCE(SUM(rt.total), 0) + COALESCE(SUM(pt.total), 0) AS revenue,
       COALESCE(SUM(pt.total), 0) AS cost
     FROM series s
     LEFT JOIN "jobs" j
       ON j."status" = 'DELIVERED'
      AND (COALESCE(
            (SELECT MAX(a."createdAt") FROM "audit_logs" a
             WHERE a."jobId" = j."id"
               AND a."action" = 'STATUS_CHANGED' AND a."toValue" = 'DELIVERED'),
            j."updatedAt"
          ) AT TIME ZONE ${shopTz})::date = s.day
      ${technicianCond}
     LEFT JOIN repair_totals rt ON rt."jobId" = j."id"
     LEFT JOIN parts_totals pt ON pt."jobId" = j."id"
     GROUP BY s.day
     ORDER BY s.day ASC`
  );
}

export function auditLogFindMany(
  prisma: DbClient,
  where: Prisma.AuditLogWhereInput,
  include: Prisma.AuditLogInclude,
  orderBy: Prisma.AuditLogOrderByWithRelationInput,
  take: number
) {
  return prisma.auditLog.findMany({ where, include, orderBy, take });
}

export function countWaitingForParts(prisma: DbClient, userId: string) {
  return prisma.job.count({
    where: { technicianId: userId, status: "WAITING_FOR_PARTS" },
  });
}

interface LowStockPartRow {
  id: string;
  name: string;
  reorderLevel: number;
  stockQuantity: number;
}

export function findLowStockParts(prisma: DbClient, take: number) {
  return prisma.$queryRaw<LowStockPartRow[]>(
    Prisma.sql`SELECT id, name, "stockQuantity", "reorderLevel"
      FROM parts_catalog
      WHERE "stockQuantity" <= "reorderLevel"
        AND "reorderLevel" > 0
        AND "isActive" = true
      ORDER BY "stockQuantity" ASC
      LIMIT ${take}`
  );
}

export function findKanbanJobs(prisma: DbClient, where: Prisma.JobWhereInput) {
  return prisma.job.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      device: { select: { model: true, brand: { select: { name: true } } } },
    },
    orderBy: [{ isUrgent: "desc" }, { createdAt: "desc" }],
  });
}
