import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import type { AddJobPartInput } from "@shared/schemas/job.schema";
import {
  createPart as createPartRepo,
  deletePartById,
  findJobById,
  findPartWithJob,
} from "../repositories/job-part.repository.js";
import { assertJobMutable } from "../utils/job-mutations.js";
import { createAuditLog } from "./audit.service.js";

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

  // Catalog parts decrement stock atomically: the conditional updateMany
  // guards against overselling when two jobs consume the last unit.
  const result = await prisma.$transaction(async (tx) => {
    if (input.partId) {
      const updated = await tx.partsCatalog.updateMany({
        where: { id: input.partId, stockQuantity: { gte: input.quantity } },
        data: { stockQuantity: { decrement: input.quantity } },
      });
      if (updated.count === 0) {
        return { error: "INSUFFICIENT_STOCK" as const };
      }
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
      await tx.partsCatalog.update({
        where: { id: part.partId },
        data: { stockQuantity: { increment: part.quantity } },
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
