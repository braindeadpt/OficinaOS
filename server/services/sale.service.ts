import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { CreateSaleInput } from "@shared/schemas/sale.schema";
import type { FastifyInstance } from "fastify";
import {
  createSale,
  decrementStock,
  findCatalogPartsByIds,
  findSaleSortKey,
} from "../repositories/sale.repository.js";
import { createStockMovement } from "../repositories/stock-movement.repository.js";
import {
  keysetOrderBy,
  requireKeysetCursor,
  withKeyset,
} from "../utils/keyset.js";
import { generateSaleCode } from "../utils/sale-code.js";
import { alertLowStock } from "./low-stock.service.js";

export interface CreateSaleResult {
  id: string;
  saleCode: string;
}

/**
 * Counter sale (POS): items may be catalog parts (stock-decremented,
 * snapshotted) or ad-hoc accessories. Payments must sum to the total.
 * Everything happens in one transaction — insufficient stock or an
 * unknown catalog part aborts the whole sale. A low-stock alert fires
 * inside the transaction when a catalog part crosses its reorder level.
 */
export async function create(
  prisma: PrismaClient,
  app: FastifyInstance,
  input: CreateSaleInput,
  userId: string
): Promise<CreateSaleResult> {
  const catalogItemIds = [
    ...new Set(
      input.items.map((i) => i.partId).filter((id): id is string => !!id)
    ),
  ];
  const catalogParts = catalogItemIds.length
    ? await findCatalogPartsByIds(prisma, catalogItemIds)
    : [];
  const catalogById = new Map(catalogParts.map((p) => [p.id, p]));

  const items = input.items.map((item) => {
    const part = item.partId ? catalogById.get(item.partId) : undefined;
    if (item.partId && !part) {
      throw new AppError("PART_NOT_FOUND");
    }
    return {
      category: item.category,
      lineTotal: item.unitPrice * item.quantity,
      name: item.name,
      partId: item.partId ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    };
  });

  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  const customerId = input.customerId?.trim() || null;

  return prisma.$transaction(async (tx) => {
    // Atomic decrement: abort the whole sale if any catalog line is short.
    for (const item of items) {
      if (!item.partId) {
        continue;
      }
      const updated = await decrementStock(tx, item.partId, item.quantity);
      if (updated.count === 0) {
        throw new AppError("INSUFFICIENT_STOCK");
      }
    }

    const saleCode = await generateSaleCode(tx);

    // Ledger entry per catalog line: POS consumption feeds the same
    // ledger as repair consumption, powering restock analytics.
    for (const item of items) {
      if (!item.partId) {
        continue;
      }
      const part = catalogById.get(item.partId);
      await createStockMovement(tx, {
        // Best-effort post-decrement balance from the pre-read snapshot.
        balanceAfter: part ? part.stockQuantity - item.quantity : 0,
        createdById: userId,
        partId: item.partId,
        quantity: -item.quantity,
        type: "CONSUMPTION",
      });
    }

    const created = await createSale(tx, {
      saleCode,
      items: {
        create: items.map((item) => ({
          category: item.category,
          lineTotal: item.lineTotal,
          name: item.name,
          part: item.partId ? { connect: { id: item.partId } } : undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
      payments: {
        create: input.payments.map((p) => ({
          amount: p.amount,
          method: p.method,
          reference: p.reference ?? null,
        })),
      },
      total,
      ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
      createdBy: { connect: { id: userId } },
    });

    // Low-stock alert for catalog parts pushed to their reorder level.
    for (const partId of [...new Set(catalogItemIds)]) {
      await alertLowStock(app, partId, tx);
    }

    return created;
  });
}

export function getById(prisma: PrismaClient, id: string) {
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

export async function list(
  prisma: PrismaClient,
  query: { cursor?: string; limit?: number }
) {
  const limit = query.limit ?? 20;
  // Sorted by createdAt, so a page must resume on createdAt too — paging on id
  // alone would re-emit rows the caller already has and skip others.
  const where = query.cursor
    ? withKeyset(
        {},
        requireKeysetCursor(
          await findSaleSortKey(prisma, query.cursor),
          "createdAt"
        ),
        "createdAt",
        "desc"
      )
    : {};

  const sales = await prisma.sale.findMany({
    orderBy: keysetOrderBy("createdAt", "desc"),
    take: limit + 1,
    where,
    include: {
      items: { select: { name: true, quantity: true } },
      payments: true,
      createdBy: { select: { name: true } },
    },
  });

  let nextCursor: string | null = null;
  if (sales.length > limit) {
    const last = sales.pop();
    if (last) {
      nextCursor = last.id;
    }
  }
  return { nextCursor, sales };
}
