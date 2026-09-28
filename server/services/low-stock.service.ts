import { Role } from "@shared/constants/roles";
import type { FastifyInstance } from "fastify";
import type { DbClient } from "../repositories/types.js";
import { notify } from "../services/notification-dispatch.js";

const RE_ALERT_MS = 24 * 60 * 60 * 1000;

/** Prisma delegate subset so both PrismaClient and tx clients are accepted. */
export type LowStockTx = Pick<DbClient, "partsCatalog">;

/**
 * Sends a low-stock alert to OWNERs when a part is at or below its
 * reorder level. Safe to call inside the stock-decrement transaction:
 * any failure is logged, never propagated. The updateMany re-checks the
 * 24h gate inside that transaction, so concurrent consumers cannot both
 * pass (only one wins the `lastLowStockAlertAt` claim).
 *
 * Returns true when an alert was dispatched.
 */
export async function alertLowStock(
  app: FastifyInstance,
  partId: string,
  tx: LowStockTx
): Promise<boolean> {
  try {
    const part = await tx.partsCatalog.findUnique({
      select: {
        isActive: true,
        name: true,
        reorderLevel: true,
        stockQuantity: true,
      },
      where: { id: partId },
    });
    if (
      !part?.isActive ||
      part.reorderLevel <= 0 ||
      part.stockQuantity > part.reorderLevel
    ) {
      return false;
    }

    const cutoff = new Date(Date.now() - RE_ALERT_MS);
    const claimed = await tx.partsCatalog.updateMany({
      data: { lastLowStockAlertAt: new Date() },
      where: {
        id: partId,
        OR: [
          { lastLowStockAlertAt: null },
          { lastLowStockAlertAt: { lt: cutoff } },
        ],
      },
    });
    if (claimed.count === 0) {
      return false;
    }

    await notify(app, {
      context: {
        partName: part.name,
        partQuantity: String(part.stockQuantity),
        partReorderLevel: String(part.reorderLevel),
      },
      eventName: "part_low_stock",
      recipients: { role: Role.OWNER },
    });
    return true;
  } catch (err) {
    // Never fail the stock operation because of notification issues.
    app.log.warn({ err, partId }, "failed to send low-stock alert");
    return false;
  }
}

/**
 * Hourly sweep: re-checks every active part at or below its reorder level
 * (column comparison needs raw SQL) so alerts still fire after manual
 * stock adjustments, seed data, or a missed consumption hook while the
 * server was down. Deduplicated by the same 24h gate.
 */
export function startLowStockScheduler(app: FastifyInstance): () => void {
  const INTERVAL_MS = 60 * 60 * 1000;

  const sweep = async (): Promise<void> => {
    try {
      const candidates = await app.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "parts_catalog"
        WHERE "isActive" = true
          AND "reorderLevel" > 0
          AND "stockQuantity" <= "reorderLevel"
          AND ("lastLowStockAlertAt" IS NULL
               OR "lastLowStockAlertAt" < now() - interval '24 hours')
        LIMIT 20
      `;
      for (const { id } of candidates) {
        await alertLowStock(app, id, app.prisma);
      }
    } catch (err) {
      app.log.error(err, "low-stock scheduler tick failed");
    }
  };

  const handle = setInterval(sweep, INTERVAL_MS);
  if (handle.unref) {
    handle.unref();
  }
  // Initial sweep runs shortly after boot, not blocking startup.
  const initial = setTimeout(sweep, 30_000);
  if (initial.unref) {
    initial.unref();
  }

  return () => {
    clearInterval(handle);
    clearTimeout(initial);
  };
}
