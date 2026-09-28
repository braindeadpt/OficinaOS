import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import type { AddJobPartInput } from "@shared/schemas/job.schema";
import { getAppInstance } from "../jobs/app-registry.js";
import {
  createPart as createPartRepo,
  deletePartById,
  findJobById,
  findPartWithJob,
} from "../repositories/job-part.repository.js";
import { createStockMovement } from "../repositories/stock-movement.repository.js";
import { assertJobMutable } from "../utils/job-mutations.js";
import { createAuditLog } from "./audit.service.js";
import { alertLowStock } from "./low-stock.service.js";

export async function add(
  prisma: PrismaClient,
  jobId: string,
  input: AddJobPartInput,
  userId: string
) {
  const job = await findJobById(prisma, jobId);
  if (!job) {
    return null;
  }
  const mutabilityError = assertJobMutable(job);
  if (mutabilityError) {
    return mutabilityError;
  }

  const totalCost = input.unitPrice * input.quantity;

  // Catalog parts decrement stock atomically: the conditional raw update
  // guards against overselling when two jobs consume the last unit, and
  // RETURNING exposes the exact balance for the movement ledger.
  const result = await prisma.$transaction(async (tx) => {
    if (input.partId) {
      const decremented = await tx.$queryRaw<{ stock_quantity: number }[]>`
        UPDATE "parts_catalog"
        SET "stockQuantity" = "stockQuantity" - ${input.quantity}
        WHERE "id" = ${input.partId} AND "stockQuantity" >= ${input.quantity}
        RETURNING "stockQuantity"
      `;
      if (decremented.length === 0) {
        return { error: "INSUFFICIENT_STOCK" as const };
      }

      await createStockMovement(tx, {
        balanceAfter: decrementedReader(decremented),
        createdById: userId,
        partId: input.partId,
        quantity: -input.quantity,
        type: "CONSUMPTION",
      });
    }

    const created = await createPartRepo(tx, {
      category: input.category,
      job: { connect: { id: jobId } },
      part: input.partId ? { connect: { id: input.partId } } : undefined,
      partName: input.partName,
      quantity: input.quantity,
      supplier: input.supplier ?? null,
      totalCost,
      unitPrice: input.unitPrice,
      createdBy: { connect: { id: userId } },
    });

    // Alert OWNERs when this consumption pushed a catalog part to its
    // reorder level. Runs inside the same tx and swallows its own errors.
    if (input.partId) {
      const app = getAppInstance();
      if (app) {
        await alertLowStock(app, input.partId, tx);
      }
    }

    await createAuditLog(tx, {
      action: AuditAction.PART_ADDED,
      jobId,
      metadata: { partId: input.partId, totalCost },
      toValue: `${input.partName} x${input.quantity}`,
      userId,
    });

    return created;
  });

  return result;
}

export async function remove(
  prisma: PrismaClient,
  jobId: string,
  partId: string,
  userId: string
) {
  const part = await findPartWithJob(prisma, partId, jobId);
  if (!part) {
    return null;
  }
  const mutabilityError = assertJobMutable(part.job);
  if (mutabilityError) {
    return mutabilityError;
  }

  await prisma.$transaction(async (tx) => {
    await deletePartById(tx, partId);
    // Restore stock for catalog parts consumed by this line.
    if (part.partId) {
      const updated = await tx.partsCatalog.update({
        where: { id: part.partId },
        data: { stockQuantity: { increment: part.quantity } },
        select: { stockQuantity: true },
      });
      await createStockMovement(tx, {
        balanceAfter: updated.stockQuantity,
        createdById: userId,
        partId: part.partId,
        quantity: part.quantity,
        type: "RETURN",
      });
    }
    await createAuditLog(tx, {
      action: AuditAction.PART_REMOVED,
      fromValue: `${part.partName} x${part.quantity}`,
      jobId,
      userId,
    });
  });

  return true;
}

function decrementedReader(
  rows: Array<{ stock_quantity: number | string }>
): number {
  const first = rows[0]?.stock_quantity;
  return typeof first === "string" ? Number.parseInt(first, 10) : (first ?? 0);
}
