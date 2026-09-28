import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

export interface StockCandidate {
  id: string;
  stockQuantity: number;
}

export function findCatalogPartsByIds(
  prisma: DbClient,
  ids: string[]
): Promise<StockCandidate[]> {
  return prisma.partsCatalog.findMany({
    where: { id: { in: ids } },
    select: { id: true, stockQuantity: true },
  });
}

export function decrementStock(
  prisma: DbClient,
  id: string,
  quantity: number
): Promise<{ count: number }> {
  return prisma.partsCatalog.updateMany({
    where: { id, stockQuantity: { gte: quantity } },
    data: { stockQuantity: { decrement: quantity } },
  });
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

export function listSales(
  prisma: DbClient,
  where: Prisma.SaleWhereInput,
  take: number
) {
  return prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      items: { select: { name: true, quantity: true } },
      payments: true,
      createdBy: { select: { name: true } },
    },
  });
}
