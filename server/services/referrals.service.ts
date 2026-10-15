import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  createReferralSchema,
  updateReferralSchema,
} from "@shared/schemas/referral.schema";
import type { z } from "zod";

type CreateInput = z.infer<typeof createReferralSchema>;
type UpdateInput = z.infer<typeof updateReferralSchema>;

export function listForJob(prisma: PrismaClient, jobId: string) {
  return prisma.jobReferral.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
    },
  });
}

export async function create(
  prisma: PrismaClient,
  jobId: string,
  input: CreateInput,
  userId: string
) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new AppError("NOT_FOUND");
  }
  // Referral + the job note trail it must exist atomically — a referral
  // without its note (or a note without the referral) corrupts the audit.
  return prisma.$transaction(async (tx) => {
    const referral = await tx.jobReferral.create({
      data: { ...input, jobId, createdById: userId },
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
      },
    });
    await tx.jobNote.create({
      data: {
        jobId,
        createdById: userId,
        content: `Reparação encaminhada para ${input.toShopName}${
          input.reason ? ` — ${input.reason}` : ""
        }`,
      },
    });
    return referral;
  });
}

const TERMINAL_REFERRAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

// Referral lifecycle: SENT → ACCEPTED → COMPLETED, CANCELLED from any
// non-terminal state. A terminal referral reopens to SENT (clears
// resolvedAt) — anything else is INVALID_TRANSITION (409).
const REFERRAL_TRANSITIONS: Record<string, string[]> = {
  SENT: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["SENT"],
  CANCELLED: ["SENT"],
};

export async function update(
  prisma: PrismaClient,
  id: string,
  input: UpdateInput
) {
  const existing = await prisma.jobReferral.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("NOT_FOUND");
  }
  const include = {
    createdBy: { select: { id: true, name: true, username: true } },
  };
  const data: Record<string, unknown> = { ...input };
  if (input.status && input.status !== existing.status) {
    if (!REFERRAL_TRANSITIONS[existing.status]?.includes(input.status)) {
      throw new AppError("INVALID_TRANSITION");
    }
    if (input.status === "SENT") {
      data.resolvedAt = null;
    } else if (TERMINAL_REFERRAL_STATUSES.has(input.status)) {
      data.resolvedAt = new Date();
    }
    // Atomic claim: a concurrent transition between the read and this write
    // must not overwrite — update only if the status still matches.
    const claimed = await prisma.jobReferral.updateMany({
      where: { id, status: existing.status },
      data,
    });
    if (claimed.count === 0) {
      throw new AppError("INVALID_TRANSITION");
    }
    return prisma.jobReferral.findUniqueOrThrow({ where: { id }, include });
  }
  return prisma.jobReferral.update({ where: { id }, data, include });
}
