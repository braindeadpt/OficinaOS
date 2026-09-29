import type { PrismaClient } from "@generated/client";
import type { RestockSuggestion } from "@shared/types";
import type { DbClient } from "../repositories/types.js";

const AVG_WINDOW_DAYS = 30;
const TARGET_COVER_DAYS = 14;

/**
 * Restock suggestion computed from the stock-movement ledger. Average
 * daily consumption comes from CONSUMPTION movements in the trailing
 * 30-day window (one aggregate fetch); the reorder point is the demand
 * over the target cover period (no supplier lead time is tracked yet),
 * and the suggestion tops the current stock up to that point.
 *
 * Returns null when the part does not exist. With no consumption data
 * the numbers come back zero/null — the UI shows "no data" instead of
 * inventing a quantity; the per-part reorderLevel field covers that case.
 */
export async function suggestRestock(
  prisma: PrismaClient,
  partId: string,
  now: Date = new Date()
): Promise<RestockSuggestion | null> {
  const db = prisma as unknown as DbClient;
  const part = await db.partsCatalog.findUnique({
    select: {
      isActive: true,
      name: true,
      reorderLevel: true,
      stockQuantity: true,
      supplier: true,
    },
    where: { id: partId },
  });
  if (!part) {
    return null;
  }

  const since = new Date(now.getTime() - AVG_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const movements = await db.stockMovement.findMany({
    select: { createdAt: true, quantity: true },
    where: {
      createdAt: { gte: since },
      partId,
      type: "CONSUMPTION",
    },
  });

  const recentConsumedTotal = movements.reduce(
    (sum, m) => sum + Math.abs(m.quantity),
    0
  );
  const avgDailyConsumption = round2(recentConsumedTotal / AVG_WINDOW_DAYS);
  const reorderPoint = Math.ceil(avgDailyConsumption * TARGET_COVER_DAYS);
  const suggestedQuantity = Math.max(0, reorderPoint - part.stockQuantity);

  return {
    avgDailyConsumption,
    daysOfStockLeft:
      avgDailyConsumption > 0
        ? Math.floor(part.stockQuantity / avgDailyConsumption)
        : null,
    recentConsumedTotal,
    reorderPoint,
    soldOutNow: part.stockQuantity <= 0,
    stockQuantity: part.stockQuantity,
    suggestedQuantity,
    supplier: part.supplier,
    windowDays: AVG_WINDOW_DAYS,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
