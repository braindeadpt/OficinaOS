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
  countStockMovements,
  createStockMovement,
} from "../repositories/stock-movement.repository.js";
import {
  keysetOrderBy,
  requireKeysetCursor,
  withKeyset,
} from "../utils/keyset.js";
import { markStoreDirty } from "./storefront.service.js";

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
  const part = await createPart(prisma, {
    category: input.category,
    defaultPrice: input.defaultPrice,
    listedOnline: input.listedOnline ?? false,
    name: input.name,
    supplier: input.supplier ?? null,
  });
  if (part.listedOnline) {
    await markStoreDirty(prisma).catch(() => null);
  }
  return part;
}

export async function update(
  prisma: PrismaClient,
  id: string,
  input: UpdatePartInput,
  userId: string
) {
  const part = await findPartUnique(prisma, id);
  if (!part) {
    return null;
  }

  const stockDelta =
    input.stockQuantity === undefined
      ? 0
      : input.stockQuantity - (part.stockQuantity ?? 0);
  const markDirty = async (listedBefore: boolean, listedAfter?: boolean) => {
    if (listedBefore || listedAfter) {
      await markStoreDirty(prisma).catch(() => null);
    }
  };

  if (stockDelta === 0) {
    const updated = await updatePart(prisma, id, input);
    await markDirty(part.listedOnline, updated.listedOnline);
    return updated;
  }

  // A direct stock edit still goes through the movement ledger: record the
  // signed delta as an ADJUSTMENT so physical count and history stay in
  // sync. The increment is applied atomically inside the transaction — a
  // concurrent POS sale between the read above and this write must not be
  // overwritten by an absolute value.
  const { stockQuantity: _target, ...rest } = input;
  const updated = await prisma.$transaction(async (tx) => {
    const part2 = await updatePart(tx, id, {
      ...rest,
      stockQuantity: { increment: stockDelta },
    });
    await createStockMovement(tx, {
      balanceAfter: part2.stockQuantity,
      createdById: userId,
      partId: id,
      quantity: stockDelta,
      type: "ADJUSTMENT",
    });
    return part2;
  });
  // Stock de um artigo listado afeta o "em stock" da montra pública.
  await markDirty(part.listedOnline, updated.listedOnline);
  return updated;
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

  const updated = await updatePart(prisma, id, { isActive });
  if (part.listedOnline) {
    await markStoreDirty(prisma).catch(() => null);
  }
  return updated;
}

export async function remove(prisma: PrismaClient, id: string) {
  return await prisma.$transaction(async (tx) => {
    const part = await findPartUnique(tx, id);
    if (!part) {
      return null;
    }

    // StockMovement.part is onDelete: Restrict — a part that ever moved
    // stock can't be deleted either, so check both references up front
    // instead of letting Postgres throw P2003.
    const [refCount, movementCount] = await Promise.all([
      countJobPartsByPartId(tx, id),
      countStockMovements(tx, { partId: id }),
    ]);
    if (refCount > 0 || movementCount > 0) {
      throw new AppError("PART_IN_USE");
    }

    const deleted = await deletePartRepo(tx, id);
    if (deleted.listedOnline) {
      await markStoreDirty(tx).catch(() => null);
    }
    return deleted;
  });
}
