import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

export interface StockCandidate {
  defaultPrice: Prisma.Decimal;
  id: string;
  stockQuantity: number;
}

export function findCatalogPartsByIds(
  prisma: DbClient,
  ids: string[]
): Promise<StockCandidate[]> {
  return prisma.partsCatalog.findMany({
    where: { id: { in: ids } },
    select: { id: true, stockQuantity: true, defaultPrice: true },
  });
}

export async function decrementStock(
  prisma: DbClient,
  id: string,
  quantity: number
): Promise<{ balanceAfter: number } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ stockQuantity: number | string }>
  >`
    UPDATE "parts_catalog"
    SET "stockQuantity" = "stockQuantity" - ${quantity}
    WHERE "id" = ${id} AND "stockQuantity" >= ${quantity}
    RETURNING "stockQuantity"
  `;
  if (rows.length === 0) {
    return null;
  }
  const first = rows[0]?.stockQuantity;
  return {
    balanceAfter:
      typeof first === "string" ? Number.parseInt(first, 10) : (first ?? 0),
  };
}

export function createSale(
  prisma: DbClient,
  data: Prisma.SaleCreateInput
): Promise<{ id: string; saleCode: string }> {
  return prisma.sale.create({
    data,
    select: { id: true, saleCode: true },
  });
}

export function findSaleById(prisma: DbClient, id: string) {
  return prisma.sale.findUnique({
    where: { id },
    include: {
      items: true,
      payments: true,
      customer: { select: { id: true, name: true, phone: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
}

/** Sort key of a row, for resolving a keyset cursor back to its position. */
export function findSaleSortKey(prisma: DbClient, id: string) {
  return prisma.sale.findUnique({
    where: { id },
    select: { id: true, createdAt: true },
  });
}
