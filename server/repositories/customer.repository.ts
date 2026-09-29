import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type CustomerWhereInput = Prisma.CustomerWhereInput;
type CustomerOrderByWithRelationInput =
  | Prisma.CustomerOrderByWithRelationInput
  | Prisma.CustomerOrderByWithRelationInput[];
type CustomerInclude = Prisma.CustomerInclude;

export async function upsert(
  prisma: DbClient,
  where: Prisma.CustomerWhereUniqueInput,
  update: Record<string, unknown>,
  create: Prisma.CustomerCreateInput
) {
  return await prisma.customer.upsert({ where, update, create });
}

export async function findUnique(prisma: DbClient, id: string) {
  return await prisma.customer.findUnique({ where: { id } });
}

export async function findCustomerByPhone(prisma: DbClient, phone: string) {
  return await prisma.customer.findUnique({ where: { phone } });
}

export async function findUniqueWithJobs(prisma: DbClient, id: string) {
  return await prisma.customer.findUnique({
    where: { id },
    include: {
      jobs: {
        include: {
          device: {
            select: { model: true, brand: { select: { name: true } } },
          },
          repairs: { select: { repairName: true, price: true } },
          partsUsed: { select: { partName: true, totalCost: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function findMany(
  prisma: DbClient,
  where: CustomerWhereInput,
  include: CustomerInclude,
  orderBy: CustomerOrderByWithRelationInput,
  take: number
) {
  return await prisma.customer.findMany({ where, include, orderBy, take });
}

export async function count(prisma: DbClient, where: CustomerWhereInput) {
  return await prisma.customer.count({ where });
}

export async function search(
  prisma: DbClient,
  where: CustomerWhereInput,
  select: Prisma.CustomerSelect,
  take: number,
  orderBy: CustomerOrderByWithRelationInput
) {
  return await prisma.customer.findMany({ where, select, take, orderBy });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: Record<string, unknown>
) {
  return await prisma.customer.update({ where: { id }, data });
}
