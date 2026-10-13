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
  const referral = await prisma.jobReferral.create({
    data: { ...input, jobId, createdById: userId },
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
    },
  });
  await prisma.jobNote.create({
    data: {
      jobId,
      createdById: userId,
      content: `Reparação encaminhada para ${input.toShopName}${
        input.reason ? ` — ${input.reason}` : ""
      }`,
    },
  });
  return referral;
}

const TERMINAL_REFERRAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

export async function update(
  prisma: PrismaClient,
  id: string,
  input: UpdateInput
) {
  const existing = await prisma.jobReferral.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("NOT_FOUND");
  }
  const data: Record<string, unknown> = { ...input };
  if (
    input.status &&
    TERMINAL_REFERRAL_STATUSES.has(input.status) &&
    !existing.resolvedAt
  ) {
    data.resolvedAt = new Date();
  }
  return prisma.jobReferral.update({
    where: { id },
    data,
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
    },
  });
}
