import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import type { AddWaitingPartInput } from "@shared/schemas/job.schema";
import {
  createWaitingPart as createWaitingPartRepo,
  deleteWaitingPart,
  findJobById,
  findWaitingPartByIdAndJob,
} from "../repositories/job-waiting-parts.repository.js";
import { assertJobMutable } from "../utils/job-mutations.js";
import { createAuditLog } from "./audit.service.js";

export async function add(
  prisma: PrismaClient,
  jobId: string,
  input: AddWaitingPartInput,
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

  const waitingPart = await prisma.$transaction(async (tx) => {
    const created = await createWaitingPartRepo(tx, {
      job: { connect: { id: jobId } },
      partName: input.partName,
      supplier: input.supplier ?? null,
    });

    await createAuditLog(tx, {
      jobId,
      userId,
      action: AuditAction.PART_ADDED,
      note: `Waiting part added: ${input.partName}`,
      toValue: input.partName,
    });

    return created;
  });

  return waitingPart;
}

export async function remove(
  prisma: PrismaClient,
  jobId: string,
  waitingId: string,
  userId: string
) {
  const waitingPart = await findWaitingPartByIdAndJob(prisma, waitingId, jobId);
  if (!waitingPart) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await deleteWaitingPart(tx, waitingId);

    await createAuditLog(tx, {
      jobId,
      userId,
      action: AuditAction.PART_REMOVED,
      note: `Waiting part removed: ${waitingPart.partName}`,
      fromValue: waitingPart.partName,
    });
  });

  return true;
}
