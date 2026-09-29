import type { PrismaClient } from "@generated/client";
import type {
  RestockForecastDTO,
  RestockForecastRow,
} from "@shared/types/reports";
import { findMany as findManyParts } from "../repositories/part.repository.js";
import { groupConsumedQuantity } from "../repositories/stock-movement.repository.js";
import type { DbClient } from "../repositories/types.js";

/**
 * Restock forecast: estimates how many days of stock remain per part and
 * suggests a purchase quantity.
 *
 * - Consumption comes from StockMovement CONSUMPTION rows over the analysis
 *   window (30 days), averaged per day. PURCHASE/RETURN/ADJUSTMENT rows are
 *   ignored — restocking must not mask real demand.
 * - daysLeft = stock / avgDailyUsage (null when the part had no consumption).
 * - suggestedQuantity rounds the window-length demand up to the reorder
 *   level (never below it) and subtracts current stock; only parts whose
 *   coverage falls at or below the reorder threshold are returned.
 */
export async function restockForecast(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<RestockForecastDTO> {
  const db = prisma as unknown as DbClient;
  const windowDays = 30;

  const { start } = todayRange(now);
  const windowStart = new Date(start.getTime() - (windowDays - 1) * 86_400_000);

  const [activeParts, consumedRows] = await Promise.all([
    findManyParts(db, { isActive: true }, { name: "asc" }, windowDays + 5),
    groupConsumedQuantity(db, {
      createdAt: { gte: windowStart },
      type: "CONSUMPTION",
    }),
  ]);

  const consumedByPart = new Map(
    consumedRows.map((row) => [row.partId, Number(row._sum.quantity ?? 0)])
  );

  const rows: RestockForecastRow[] = [];
  let partsAtRisk = 0;
  let totalSuggestedQuantity = 0;

  for (const part of activeParts) {
    // CONSUMPTION rows carry signed (negative) quantities — usage is the
    // absolute amount taken off the shelf.
    const consumed = Math.abs(consumedByPart.get(part.id) ?? 0);
    const avgDailyUsage = Math.round(((consumed / windowDays) * 10) / 10);
    const daysLeft =
      avgDailyUsage > 0 ? Math.floor(part.stockQuantity / avgDailyUsage) : null;

    const reorderTarget = Math.max(part.reorderLevel, 1);
    const suggestedQuantity =
      avgDailyUsage > 0
        ? Math.max(reorderTarget, avgDailyUsage * windowDays) -
          part.stockQuantity
        : reorderTarget - part.stockQuantity;
    if (suggestedQuantity <= 0) {
      continue;
    }

    partsAtRisk += 1;
    totalSuggestedQuantity += suggestedQuantity;
    rows.push({
      avgDailyUsage,
      daysLeft,
      partId: part.id,
      partName: part.name,
      reorderLevel: part.reorderLevel,
      stockQuantity: part.stockQuantity,
      suggestedQuantity,
      supplier: part.supplier,
    });
  }

  rows.sort((a, b) => {
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db2 = b.daysLeft ?? Number.POSITIVE_INFINITY;
    if (da !== db2) {
      return da - db2;
    }
    return b.suggestedQuantity - a.suggestedQuantity;
  });

  return {
    rows: rows.slice(0, 50),
    summary: { partsAtRisk, totalSuggestedQuantity },
    windowDays,
  };
}

function todayRange(now: Date) {
  // Day bucketing at UTC midnight keeps the window deterministic for tests;
  // usage is averaged over the window, so a small timezone offset has no
  // practical impact on the forecast.
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return { start };
}
