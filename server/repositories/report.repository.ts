import { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type JobWhereInput = Prisma.JobWhereInput;
type AuditLogWhereInput = Prisma.AuditLogWhereInput;
type ReturnClaimWhereInput = Prisma.ReturnClaimWhereInput;

export function aggregateJobRevenue(prisma: DbClient, where: JobWhereInput) {
  const statusFilter =
    where.status &&
    typeof where.status === "object" &&
    "in" in (where.status as object)
      ? (where.status as { in: string[] }).in
      : undefined;

  const technicianFilter = where.technicianId ?? undefined;

  return prisma.$queryRaw<{ revenue: string }[]>`
    SELECT COALESCE(SUM(
      COALESCE(r_total.repair_sum, 0) + COALESCE(p_total.parts_sum, 0)
    ), 0)::text AS revenue
    FROM "jobs" j
    LEFT JOIN (SELECT "jobId", SUM("price") AS repair_sum FROM "job_repairs" GROUP BY "jobId") r_total
      ON r_total."jobId" = j."id"
    LEFT JOIN (SELECT "jobId", SUM("totalCost") AS parts_sum FROM "job_parts" GROUP BY "jobId") p_total
      ON p_total."jobId" = j."id"
    ${
      where.auditLogs
        ? Prisma.sql`
    WHERE EXISTS (
      SELECT 1 FROM "audit_logs" al
      WHERE al."jobId" = j."id"
        AND al."action" = 'STATUS_CHANGED'
        AND al."toValue" IN ('DONE', 'DELIVERED')
        AND al."createdAt" >= ${
          (where.auditLogs as { some: { createdAt: { gte: Date } } }).some
            .createdAt.gte
        } AND al."createdAt" < ${
          (where.auditLogs as { some: { createdAt: { lt: Date } } }).some
            .createdAt.lt
        }
    )`
        : Prisma.sql`WHERE 1=1`
    }
    ${
      statusFilter
        ? Prisma.sql`AND j."status" IN (${Prisma.join(statusFilter)})`
        : Prisma.empty
    }
    ${
      technicianFilter
        ? Prisma.sql`AND j."technicianId" = ${technicianFilter}`
        : Prisma.empty
    }
  `;
}

export function aggregateJobDeposits(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.aggregate({
    _sum: { depositAmount: true },
    where,
  });
}

export function findOutstandingJobs(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.findMany({
    where,
    select: {
      estimatedCost: true,
      depositAmount: true,
      partsUsed: { select: { totalCost: true } },
      repairs: { select: { price: true } },
    },
  });
}

export function findRevenueBreakdown(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.findMany({
    where,
    select: {
      jobCode: true,
      estimatedCost: true,
      depositAmount: true,
      updatedAt: true,
      customer: { select: { name: true } },
      device: {
        select: { model: true, brand: { select: { name: true } } },
      },
      partsUsed: { select: { totalCost: true } },
      repairs: { select: { price: true } },
      auditLogs: {
        where: {
          action: "STATUS_CHANGED",
          toValue: { in: ["DONE", "DELIVERED"] },
        },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export function countJobs(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.count({ where });
}

export function findTurnaroundJobs(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.findMany({
    where,
    select: {
      createdAt: true,
      auditLogs: {
        where: {
          action: "STATUS_CHANGED",
          toValue: { in: ["DONE", "DELIVERED"] },
        },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

export function groupJobRepairs(
  prisma: DbClient,
  where: Prisma.JobRepairWhereInput
) {
  return prisma.jobRepair.groupBy({
    by: ["repairName", "category"],
    where,
    _count: { _all: true },
    _avg: { price: true },
    _sum: { price: true },
  });
}

export function groupJobPartsForConsumption(
  prisma: DbClient,
  where: Prisma.JobPartWhereInput
) {
  return prisma.jobPart.groupBy({
    by: ["partName", "category"],
    where,
    _count: { _all: true },
    _avg: { unitPrice: true },
    _sum: { quantity: true, totalCost: true },
  });
}

export function groupSaleItemsForConsumption(
  prisma: DbClient,
  where: Prisma.SaleItemWhereInput
) {
  return prisma.saleItem.groupBy({
    by: ["name", "category"],
    where,
    _count: { _all: true },
    _avg: { unitPrice: true },
    _sum: { quantity: true, lineTotal: true },
  });
}

export function findAuditLogsForStatus(
  prisma: DbClient,
  where: AuditLogWhereInput,
  take: number
) {
  return prisma.auditLog.findMany({
    where,
    select: {
      toValue: true,
      createdAt: true,
      job: { select: { createdAt: true } },
    },
    take,
  });
}

export function groupJobsByStatus(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.groupBy({
    by: ["status"],
    _count: { _all: true },
    where,
  });
}

export function groupJobsByCustomer(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.groupBy({
    by: ["customerId"],
    where,
    _count: { _all: true },
    _sum: { estimatedCost: true },
  });
}

export function groupJobsByCustomerWithMinDate(
  prisma: DbClient,
  where: JobWhereInput
) {
  return prisma.job.groupBy({
    by: ["customerId"],
    where,
    _min: { createdAt: true },
  });
}

export function countJobsSimple(prisma: DbClient, where: JobWhereInput) {
  return prisma.job.count({ where });
}

export function groupTopCustomersByRevenue(
  prisma: DbClient,
  where: JobWhereInput
) {
  return prisma.job.groupBy({
    by: ["customerId"],
    where,
    _count: { _all: true },
    _sum: { estimatedCost: true },
    _max: { createdAt: true },
    orderBy: { _sum: { estimatedCost: "desc" } },
    take: 20,
  });
}

export function findCustomersByIds(prisma: DbClient, ids: string[]) {
  return prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, phone: true },
  });
}

export function queryRawProfitMargin(
  prisma: DbClient,
  rangeStart: Date,
  rangeEnd: Date,
  isTechnician: boolean,
  technicianId?: string
) {
  return prisma.$queryRaw<{ cost: string }[]>`
    SELECT COALESCE(SUM(pt."totalCost"), 0) AS cost
    FROM "jobs" j
    INNER JOIN "audit_logs" al ON al."jobId" = j."id"
      AND al."action" = 'STATUS_CHANGED'
      AND al."toValue" IN ('DONE', 'DELIVERED')
      AND al."createdAt" >= ${rangeStart} AND al."createdAt" < ${rangeEnd}
    LEFT JOIN (SELECT "jobId", SUM("totalCost") AS "totalCost" FROM "job_parts" GROUP BY "jobId") pt
      ON pt."jobId" = j."id"
    WHERE j."status" IN ('DONE', 'DELIVERED')
      ${
        isTechnician
          ? Prisma.sql`AND j."technicianId" = ${technicianId}`
          : Prisma.empty
      }
  `;
}

export function countReturnClaims(
  prisma: DbClient,
  where: ReturnClaimWhereInput
) {
  return prisma.returnClaim.count({ where });
}
