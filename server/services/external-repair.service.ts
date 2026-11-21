import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  ExternalRepairCreateInput,
  ExternalRepairReturnInput,
} from "@shared/schemas/external-repair.schema.js";

const repairInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, username: true } },
} as const;

export async function createExternalRepair(
  prisma: PrismaClient,
  jobId: string,
  data: ExternalRepairCreateInput,
  userId: string
) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError("JOB_NOT_FOUND");
  }
  const supplier = await prisma.supplier.findUnique({
    where: { id: data.supplierId },
  });
  if (!supplier?.isActive) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { supplierId: ["validations.invalid_option"] },
    });
  }
  const open = await prisma.externalRepair.findFirst({
    where: { jobId, status: "SENT" },
  });
  if (open) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { externalRepair: ["validations.invalid_option"] },
    });
  }
  return await prisma.externalRepair.create({
    data: {
      jobId,
      supplierId: data.supplierId,
      kind: data.kind,
      reference: data.reference || null,
      notes: data.notes || null,
      expectedReturnAt: data.expectedReturnAt ?? null,
      createdById: userId,
    },
    include: repairInclude,
  });
}

export async function listExternalRepairs(prisma: PrismaClient, jobId: string) {
  return await prisma.externalRepair.findMany({
    where: { jobId },
    include: repairInclude,
    orderBy: { sentAt: "desc" },
  });
}

export async function returnExternalRepair(
  prisma: PrismaClient,
  id: string,
  data: ExternalRepairReturnInput
) {
  const repair = await prisma.externalRepair.findUnique({ where: { id } });
  if (!repair) {
    throw new AppError("NOT_FOUND");
  }
  if (repair.status !== "SENT") {
    throw new AppError("VALIDATION_ERROR", {
      errors: { status: ["validations.invalid_option"] },
    });
  }
  return await prisma.externalRepair.update({
    where: { id },
    data: {
      status: "RETURNED",
      returnedAt: new Date(),
      costFinal: data.costFinal ?? null,
      notes: data.notes ?? repair.notes,
    },
    include: repairInclude,
  });
}

export async function cancelExternalRepair(prisma: PrismaClient, id: string) {
  const repair = await prisma.externalRepair.findUnique({ where: { id } });
  if (!repair) {
    throw new AppError("NOT_FOUND");
  }
  if (repair.status !== "SENT") {
    throw new AppError("VALIDATION_ERROR", {
      errors: { status: ["validations.invalid_option"] },
    });
  }
  return await prisma.externalRepair.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: repairInclude,
  });
}
