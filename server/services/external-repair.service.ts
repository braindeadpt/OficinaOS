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

const OPEN_REPAIR_ERROR = {
  errors: { externalRepair: ["validations.invalid_option"] },
} as const;

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

// Date-only input ("YYYY-MM-DD") coerces to UTC midnight; store at noon UTC so
// every realistic shop timezone renders the same calendar day.
function toNoonUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)
  );
}

export async function createExternalRepair(
  prisma: PrismaClient,
  jobId: string,
  data: ExternalRepairCreateInput,
  userId: string
) {
  try {
    // Same job-row lock the status transition takes: a delivery and a send
    // can no longer both pass their checks before either writes — whoever
    // gets the lock second re-reads the committed state and loses.
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.job.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!job) {
        throw new AppError("JOB_NOT_FOUND");
      }
      if (job.status === "DELIVERED" || job.status === "CANCELLED") {
        throw new AppError("VALIDATION_ERROR", OPEN_REPAIR_ERROR);
      }
      const supplier = await tx.supplier.findUnique({
        where: { id: data.supplierId },
      });
      if (!supplier?.isActive) {
        throw new AppError("VALIDATION_ERROR", {
          errors: { supplierId: ["validations.invalid_option"] },
        });
      }
      const open = await tx.externalRepair.findFirst({
        where: { jobId, status: "SENT" },
        select: { id: true },
      });
      if (open) {
        throw new AppError("VALIDATION_ERROR", OPEN_REPAIR_ERROR);
      }
      return await tx.externalRepair.create({
        data: {
          jobId,
          supplierId: data.supplierId,
          kind: data.kind,
          reference: data.reference || null,
          notes: data.notes || null,
          expectedReturnAt: data.expectedReturnAt
            ? toNoonUtc(data.expectedReturnAt)
            : null,
          createdById: userId,
        },
        include: repairInclude,
      });
    });
  } catch (e) {
    // Partial unique index external_repairs_one_open_per_job — belt and
    // braces behind the locked re-check above.
    if (isUniqueViolation(e)) {
      throw new AppError("VALIDATION_ERROR", OPEN_REPAIR_ERROR);
    }
    throw e;
  }
}

export async function listExternalRepairs(prisma: PrismaClient, jobId: string) {
  return await prisma.externalRepair.findMany({
    where: { jobId },
    include: repairInclude,
    orderBy: { sentAt: "desc" },
  });
}

async function transitionOpenRepair(
  prisma: PrismaClient,
  id: string,
  data: {
    status: "RETURNED" | "CANCELLED";
    returnedAt?: Date;
    costFinal?: number | null;
    notes?: string | null;
  }
) {
  // Conditional update: only a still-SENT row transitions, so a concurrent
  // return/cancel loses instead of overwriting the winner's fields.
  const updated = await prisma.externalRepair.updateMany({
    where: { id, status: "SENT" },
    data,
  });
  if (updated.count === 0) {
    const exists = await prisma.externalRepair.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new AppError("NOT_FOUND");
    }
    throw new AppError("VALIDATION_ERROR", {
      errors: { status: ["validations.invalid_option"] },
    });
  }
  return await prisma.externalRepair.findUniqueOrThrow({
    where: { id },
    include: repairInclude,
  });
}

export async function returnExternalRepair(
  prisma: PrismaClient,
  id: string,
  data: ExternalRepairReturnInput
) {
  const repair = await prisma.externalRepair.findUnique({
    where: { id },
    select: { notes: true },
  });
  if (!repair) {
    throw new AppError("NOT_FOUND");
  }
  return await transitionOpenRepair(prisma, id, {
    status: "RETURNED",
    returnedAt: new Date(),
    costFinal: data.costFinal ?? null,
    notes: data.notes ?? repair.notes,
  });
}

export async function cancelExternalRepair(prisma: PrismaClient, id: string) {
  return await transitionOpenRepair(prisma, id, { status: "CANCELLED" });
}
