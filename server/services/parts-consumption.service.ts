import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants/roles";
import type { Scope } from "@shared/types/dashboard";
import type {
  PartConsumptionRow,
  PartsConsumptionReportDTO,
} from "@shared/types/reports";
import {
  groupJobPartsForConsumption,
  groupSaleItemsForConsumption,
} from "../repositories/report.repository.js";
import type { DbClient } from "../repositories/types.js";
import type { DateRange } from "../utils/time-range.js";
import { toMoney } from "../utils/time-range.js";

interface AggRow {
  _avg: { unitPrice: unknown } | null;
  _count: { _all: number } | number;
  _sum: { lineTotal?: unknown; quantity: unknown; totalCost?: unknown };
  category: string;
  name?: string;
  partName?: string;
}

function changePercent(current: number, previous: number): number | undefined {
  if (previous === 0) {
    return;
  }
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

function mergeRows(
  jobRows: AggRow[],
  saleRows: AggRow[]
): PartConsumptionRow[] {
  const merged = new Map<
    string,
    {
      avgUnitCostSum: number;
      category: string;
      count: number;
      name: string;
      partId: string | null;
      quantity: number;
      totalCost: number;
    }
  >();

  for (const rows of [jobRows, saleRows]) {
    for (const r of rows) {
      const qty = Number(r._sum.quantity ?? 0);
      const cost = toMoney(Number(r._sum.totalCost ?? r._sum.lineTotal ?? 0));
      const count = typeof r._count === "object" ? (r._count._all ?? 0) : 0;
      const name = (r.partName ?? r.name ?? "").trim();
      const key = name.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.count += count;
        existing.quantity += qty;
        existing.totalCost = toMoney(existing.totalCost + cost);
        existing.avgUnitCostSum += Number(r._avg?.unitPrice ?? 0) * count;
      } else {
        merged.set(key, {
          avgUnitCostSum: Number(r._avg?.unitPrice ?? 0) * count,
          category: r.category,
          count,
          name,
          partId: null,
          quantity: qty,
          totalCost: cost,
        });
      }
    }
  }

  return [...merged.values()].map((m) => ({
    avgUnitCost:
      m.count > 0 ? toMoney(m.avgUnitCostSum / m.count) : toMoney(m.totalCost),
    category: m.category,
    partId: null,
    partName: m.name,
    quantity: m.quantity,
    totalCost: m.totalCost,
    usageCount: m.count,
  }));
}

function changeFor(
  rows: PartConsumptionRow[],
  prevByLowerName: Map<string, number>
): PartConsumptionRow[] {
  return rows.map((row) => {
    const prev = prevByLowerName.get(row.partName.toLowerCase());
    return prev === undefined
      ? row
      : {
          ...row,
          quantityChangePercent: changePercent(row.quantity, prev),
        };
  });
}

/**
 * Parts consumption over a period, merging repair-job parts and POS
 * accessory sales (the latter only for shop-wide viewers). Grouping is
 * by lowercase name across both sources; per-part IDs are not exposed
 * because the same accessory can exist as multiple catalog entries.
 */
export async function partsConsumptionReport(
  prisma: PrismaClient,
  scope: Scope,
  range: DateRange,
  includePosSales: boolean
): Promise<PartsConsumptionReportDTO> {
  const db = prisma as unknown as DbClient;

  const durationMs = range.end.getTime() - range.start.getTime();
  const prev: DateRange = {
    start: new Date(range.start.getTime() - durationMs),
    end: range.start,
  };

  const jobWhere = {
    createdAt: { gte: range.start, lt: range.end },
    ...(scope.role === Role.TECHNICIAN
      ? { job: { technicianId: scope.userId } }
      : {}),
  };
  const prevJobWhere = {
    createdAt: { gte: prev.start, lt: prev.end },
    ...(scope.role === Role.TECHNICIAN
      ? { job: { technicianId: scope.userId } }
      : {}),
  };

  const [jobRows, prevJobRows, saleRows, prevSaleRows] = await Promise.all([
    groupJobPartsForConsumption(db, jobWhere),
    groupJobPartsForConsumption(db, prevJobWhere),
    includePosSales
      ? groupSaleItemsForConsumption(db, {
          sale: { createdAt: { gte: range.start, lt: range.end } },
        })
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof groupSaleItemsForConsumption>>
        ),
    includePosSales
      ? groupSaleItemsForConsumption(db, {
          sale: { createdAt: { gte: prev.start, lt: prev.end } },
        })
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof groupSaleItemsForConsumption>>
        ),
  ]);

  const current = mergeRows(jobRows, saleRows);
  const previous = mergeRows(prevJobRows, prevSaleRows);

  const prevByLowerName = new Map(
    previous.map((row) => [row.partName.toLowerCase(), row.quantity])
  );

  const topParts = changeFor(
    current.sort((a, b) => b.quantity - a.quantity).slice(0, 20),
    prevByLowerName
  );

  const totalQuantity = current.reduce((s, r) => s + r.quantity, 0);
  const prevTotalQuantity = previous.reduce((s, r) => s + r.quantity, 0);

  return {
    includePosSales,
    summary: {
      distinctParts: current.length,
      totalCost: toMoney(current.reduce((s, r) => s + r.totalCost, 0)),
      totalQuantity,
      totalQuantityChangePercent: changePercent(
        totalQuantity,
        prevTotalQuantity
      ),
    },
    topParts,
  };
}
