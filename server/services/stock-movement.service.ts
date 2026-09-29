import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { CreateStockMovementInput } from "@shared/schemas/parts-catalog.schema";
import { z } from "zod";
import {
  countStockMovements,
  createStockMovement,
  findManyStockMovements,
  findStockMovementSortKey,
  findStockMovementUnique,
} from "../repositories/stock-movement.repository.js";
import {
  keysetOrderBy,
  requireKeysetCursor,
  withKeyset,
} from "../utils/keyset.js";

export const listMovementsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  type: z.enum(["PURCHASE", "CONSUMPTION", "RETURN", "ADJUSTMENT"]).optional(),
});

export type ListMovementsQueryInput = z.infer<typeof listMovementsQuerySchema>;

/**
 * Manual stock intake (supplier purchase): increments stock and appends
 * a PURCHASE movement in one transaction.
 */
export async function recordPurchase(
  prisma: PrismaClient,
  partId: string,
  input: CreateStockMovementInput,
  userId: string
) {
  const part = await prisma.partsCatalog.findUnique({
    where: { id: partId },
    select: { id: true, stockQuantity: true },
  });
  if (!part) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.partsCatalog.update({
      where: { id: partId },
      data: { stockQuantity: { increment: input.quantity } },
      select: { stockQuantity: true },
    });

    const movement = await createStockMovement(tx, {
      balanceAfter: updated.stockQuantity,
      createdById: userId,
      note: input.note ?? null,
      partId,
      quantity: input.quantity,
      reference: input.reference ?? null,
      supplier: input.supplier ?? null,
      type: "PURCHASE",
      unitCost: input.unitCost ?? null,
    });

    return { movement, stockQuantity: updated.stockQuantity };
  });
}

/**
 * Movement history for one part (newest first, cursor by id).
 */
export async function listByPart(
  prisma: PrismaClient,
  partId: string,
  query: ListMovementsQueryInput
) {
  const limit = query.limit ?? 30;
  const where = {
    partId,
    ...(query.type ? { type: query.type } : {}),
  };

  // Sorted by createdAt, so a page must resume on createdAt too — paging on id
  // alone would re-emit rows the caller already has and skip others.
  const pageWhere = query.cursor
    ? withKeyset(
        where,
        requireKeysetCursor(
          await findStockMovementSortKey(prisma, query.cursor),
          "createdAt"
        ),
        "createdAt",
        "desc"
      )
    : where;

  const movements = await findManyStockMovements(
    prisma,
    pageWhere,
    keysetOrderBy("createdAt", "desc"),
    limit + 1
  );
  const totalCount = await countStockMovements(prisma, where);

  let nextCursor: string | null = null;
  if (movements.length > limit) {
    const last = movements.pop();
    nextCursor = last?.id ?? null;
  }

  return { movements, nextCursor, totalCount };
}

/**
 * Manual correction (ADJUSTMENT movement) to reconcile physical counts.
 * quantity is the signed delta applied to current stock.
 */
export async function recordAdjustment(
  prisma: PrismaClient,
  partId: string,
  input: CreateStockMovementInput,
  userId: string
) {
  const part = await prisma.partsCatalog.findUnique({
    where: { id: partId },
    select: { id: true, stockQuantity: true },
  });
  if (!part) {
    return null;
  }

  const newStock = part.stockQuantity + input.quantity;
  if (newStock < 0) {
    throw new AppError("INSUFFICIENT_STOCK");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.partsCatalog.update({
      where: { id: partId },
      data: { stockQuantity: newStock },
      select: { stockQuantity: true },
    });

    const movement = await createStockMovement(tx, {
      balanceAfter: updated.stockQuantity,
      createdById: userId,
      note: input.note ?? null,
      partId,
      quantity: input.quantity,
      reference: input.reference ?? null,
      type: "ADJUSTMENT",
    });

    return { movement, stockQuantity: updated.stockQuantity };
  });
}

export function getMovement(prisma: PrismaClient, id: string) {
  return findStockMovementUnique(prisma, id);
}
