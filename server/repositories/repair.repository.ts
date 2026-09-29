import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type RepairCatalogWhereInput = Prisma.RepairCatalogWhereInput;
type RepairCatalogOrderByWithRelationInput =
  Prisma.RepairCatalogOrderByWithRelationInput;
type RepairCatalogCreateInput = Prisma.RepairCatalogCreateInput;

export async function findMany(
  prisma: DbClient,
  where: RepairCatalogWhereInput,
  orderBy:
    | RepairCatalogOrderByWithRelationInput
    | RepairCatalogOrderByWithRelationInput[],
  take: number
) {
  return await prisma.repairCatalog.findMany({ where, orderBy, take });
}

export async function count(prisma: DbClient, where: RepairCatalogWhereInput) {
  return await prisma.repairCatalog.count({ where });
}

export async function findUnique(prisma: DbClient, id: string) {
  return await prisma.repairCatalog.findUnique({ where: { id } });
}

/** Sort key of a row, for resolving a keyset cursor back to its position. */
export async function findSortKey(prisma: DbClient, id: string) {
  return await prisma.repairCatalog.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
}

export async function create(prisma: DbClient, data: RepairCatalogCreateInput) {
  return await prisma.repairCatalog.create({ data });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: Record<string, unknown>
) {
  return await prisma.repairCatalog.update({ where: { id }, data });
}

export async function deleteRepair(prisma: DbClient, id: string) {
  return await prisma.repairCatalog.delete({ where: { id } });
}

export async function countJobRepairsByRepairId(
  prisma: DbClient,
  repairId: string
) {
  return await prisma.jobRepair.count({ where: { repairId } });
}
