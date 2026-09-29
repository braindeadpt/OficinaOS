import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

export function createStockMovement(
  prisma: DbClient,
  data: Prisma.StockMovementUncheckedCreateInput
) {
  return prisma.stockMovement.create({ data });
}

export function findManyStockMovements(
  prisma: DbClient,
  where: Prisma.StockMovementWhereInput,
  orderBy:
    | Prisma.StockMovementOrderByWithRelationInput
    | Prisma.StockMovementOrderByWithRelationInput[],
  take: number
) {
  return prisma.stockMovement.findMany({
    where,
    orderBy,
    take,
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
    },
  });
}

export function findStockMovementUnique(prisma: DbClient, id: string) {
  return prisma.stockMovement.findUnique({ where: { id } });
}

/** Sort key of a row, for resolving a keyset cursor back to its position. */
export function findStockMovementSortKey(prisma: DbClient, id: string) {
  return prisma.stockMovement.findUnique({
    where: { id },
    select: { id: true, createdAt: true },
  });
}

export function countStockMovements(
  prisma: DbClient,
  where: Prisma.StockMovementWhereInput
) {
  return prisma.stockMovement.count({ where });
}

export function groupConsumedQuantity(
  prisma: DbClient,
  where: Prisma.StockMovementWhereInput
) {
  return prisma.stockMovement.groupBy({
    by: ["partId"],
    where,
    _sum: { quantity: true },
  });
}
