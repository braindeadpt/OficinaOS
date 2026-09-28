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
  orderBy: Prisma.StockMovementOrderByWithRelationInput,
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

export function countStockMovements(
  prisma: DbClient,
  where: Prisma.StockMovementWhereInput
) {
  return prisma.stockMovement.count({ where });
}
