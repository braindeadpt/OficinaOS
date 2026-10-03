import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type PartsCatalogWhereInput = Prisma.PartsCatalogWhereInput;
type PartsCatalogOrderByWithRelationInput =
  Prisma.PartsCatalogOrderByWithRelationInput;
type PartsCatalogCreateInput = Prisma.PartsCatalogCreateInput;

export async function findMany(
  prisma: DbClient,
  where: PartsCatalogWhereInput,
  orderBy:
    | PartsCatalogOrderByWithRelationInput
    | PartsCatalogOrderByWithRelationInput[],
  take?: number
) {
  return await prisma.partsCatalog.findMany({ where, orderBy, take });
}

export async function count(prisma: DbClient, where: PartsCatalogWhereInput) {
  return await prisma.partsCatalog.count({ where });
}

export async function findUnique(prisma: DbClient, id: string) {
  return await prisma.partsCatalog.findUnique({ where: { id } });
}

/** Sort key of a row, for resolving a keyset cursor back to its position. */
export async function findSortKey(prisma: DbClient, id: string) {
  return await prisma.partsCatalog.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
}

export async function create(prisma: DbClient, data: PartsCatalogCreateInput) {
  return await prisma.partsCatalog.create({ data });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: Record<string, unknown>
) {
  return await prisma.partsCatalog.update({ where: { id }, data });
}

export async function deletePart(prisma: DbClient, id: string) {
  return await prisma.partsCatalog.delete({ where: { id } });
}

export async function countJobPartsByPartId(prisma: DbClient, partId: string) {
  return await prisma.jobPart.count({ where: { partId } });
}
