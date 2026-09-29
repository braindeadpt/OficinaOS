import type { Prisma, PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  CreatePartInput,
  ListPartsQueryInput,
  UpdatePartInput,
} from "@shared/schemas/parts-catalog.schema";
import {
  countJobPartsByPartId,
  count as countParts,
  create as createPart,
  deletePart as deletePartRepo,
  findMany as findManyParts,
  findSortKey as findPartSortKey,
  findUnique as findPartUnique,
  update as updatePart,
} from "../repositories/part.repository.js";
import {
  keysetOrderBy,
  requireKeysetCursor,
  withKeyset,
} from "../utils/keyset.js";

export async function list(prisma: PrismaClient, query: ListPartsQueryInput) {
  const { category, cursor, isActive, limit, needsRestock, search } = query;

  const where: Prisma.PartsCatalogWhereInput = {};
  if (category) {
    where.category = category as Prisma.EnumPartCategoryFilter<"PartsCatalog">;
  }
  if (isActive !== undefined) {
    where.isActive = isActive;
  }
  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }
  if (needsRestock) {
    // Same threshold as the owner low-stock alert (see shared/utils/stock-level):
    // a configured reorder level with stock at or below it.
    where.AND = [
      { reorderLevel: { gt: 0 } },
      { stockQuantity: { lte: prisma.partsCatalog.fields.reorderLevel } },
    ];
  }
  // The list is sorted by name, so a page must resume on name too — paging on
  // id alone would re-emit rows the caller already has and skip others.
  let pageWhere = where;
  if (cursor) {
    const sortKey = await findPartSortKey(prisma, cursor);
    pageWhere = withKeyset(
      where,
      requireKeysetCursor(sortKey, "name"),
      "name",
      "asc"
    );
  }

  const [parts, totalCount] = await Promise.all([
    findManyParts(prisma, pageWhere, keysetOrderBy("name", "asc"), limit + 1),
    cursor ? Promise.resolve(null) : countParts(prisma, where),
  ]);

  let nextCursor: string | null = null;
  if (parts.length > limit) {
    const last = parts.pop();
    if (last) {
      nextCursor = last.id;
    }
  }

  return { nextCursor, parts, totalCount };
}

export async function getById(prisma: PrismaClient, id: string) {
  return await findPartUnique(prisma, id);
}

export async function create(prisma: PrismaClient, input: CreatePartInput) {
  return await createPart(prisma, {
    category: input.category,
    defaultPrice: input.defaultPrice,
    name: input.name,
    supplier: input.supplier ?? null,
  });
}

export async function update(
  prisma: PrismaClient,
  id: string,
  input: UpdatePartInput
) {
  const part = await findPartUnique(prisma, id);
  if (!part) {
    return null;
  }

  return updatePart(prisma, id, input);
}

export async function toggleActive(
  prisma: PrismaClient,
  id: string,
  isActive: boolean
) {
  const part = await findPartUnique(prisma, id);
  if (!part) {
    return null;
  }

  return updatePart(prisma, id, { isActive });
}

export async function remove(prisma: PrismaClient, id: string) {
  return await prisma.$transaction(async (tx) => {
    const part = await findPartUnique(tx, id);
    if (!part) {
      return null;
    }

    const refCount = await countJobPartsByPartId(tx, id);
    if (refCount > 0) {
      throw new AppError("PART_IN_USE");
    }

    return deletePartRepo(tx, id);
  });
}
