import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

const INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true, username: true } },
} satisfies Prisma.TradeInInclude;

export async function create(
  prisma: DbClient,
  data: Prisma.TradeInUncheckedCreateInput
) {
  return await prisma.tradeIn.create({ data, include: INCLUDE });
}

export async function findMany(
  prisma: DbClient,
  where: Prisma.TradeInWhereInput,
  orderBy: Prisma.TradeInOrderByWithRelationInput,
  skip: number,
  take: number
) {
  return await prisma.tradeIn.findMany({
    include: INCLUDE,
    orderBy,
    skip,
    take,
    where,
  });
}

export async function count(prisma: DbClient, where: Prisma.TradeInWhereInput) {
  return await prisma.tradeIn.count({ where });
}

export async function findUnique(prisma: DbClient, id: string) {
  return await prisma.tradeIn.findUnique({ include: INCLUDE, where: { id } });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: Prisma.TradeInUpdateInput
) {
  return await prisma.tradeIn.update({ data, include: INCLUDE, where: { id } });
}
