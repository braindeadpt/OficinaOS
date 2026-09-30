import type { PhotoStage, PrismaClient } from "@generated/client";
import type {
  CreateReturnClaimInput,
  ListReturnClaimsQuery,
  ResolveInput,
  TriageInput,
} from "@shared/types/return-claim.js";
import { create as createJob } from "./job.service.js";
import {
  remove as removeJobPhoto,
  upload as uploadJobPhoto,
} from "./job-photos.service.js";
import { notify } from "./notification-dispatch.js";

type DbClient = PrismaClient;
type ServiceResult<T> = T | { error: string };

/* ─── include — every read carries these relations ─────────────────────── */

const CLAIM_INCLUDE = {
  originalJob: {
    select: {
      id: true,
      jobCode: true,
      status: true,
      technicianId: true,
      customer: { select: { id: true, name: true, phone: true } },
      device: { select: { id: true, brand: true, model: true } },
      repairs: {
        select: {
          id: true,
          repairName: true,
          category: true,
          price: true,
          repair: { select: { warrantyDays: true } },
        },
      },
      partsUsed: {
        select: {
          id: true,
          partName: true,
          category: true,
          totalCost: true,
        },
      },
    },
  },
  reworkJob: {
    select: { id: true, jobCode: true, status: true },
  },
  claimedJobRepair: {
    select: { id: true, repairName: true, category: true, price: true },
  },
  claimedJobPart: {
    select: { id: true, partName: true, category: true, totalCost: true },
  },
  openedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  photos: true,
} as const;

/* ─── create ───────────────────────────────────────────────────────────── */

export async function create(
  prisma: DbClient,
  input: CreateReturnClaimInput,
  openedById: string
): Promise<ServiceResult<{ id: string }>> {
  const job = await prisma.job.findUnique({
    where: { id: input.originalJobId },
    select: { id: true, status: true, customerId: true },
  });
  if (!job) {
    return { error: "JOB_NOT_FOUND" };
  }
  if (job.status !== "DELIVERED") {
    return { error: "ORIGINAL_JOB_NOT_DELIVERED" };
  }

  if (input.claimedJobRepairId) {
    const repair = await prisma.jobRepair.findUnique({
      where: { id: input.claimedJobRepairId },
      select: { id: true, jobId: true },
    });
    if (!repair || repair.jobId !== job.id) {
      return { error: "INVALID_CLAIMED_LINE" };
    }
  }

  if (input.claimedJobPartId) {
    const part = await prisma.jobPart.findUnique({
      where: { id: input.claimedJobPartId },
      select: { id: true, jobId: true },
    });
    if (!part || part.jobId !== job.id) {
      return { error: "INVALID_CLAIMED_LINE" };
    }
  }

  const claim = await prisma.returnClaim.create({
    data: {
      originalJobId: input.originalJobId,
      claimedJobRepairId: input.claimedJobRepairId,
      claimedJobPartId: input.claimedJobPartId,
      returnReason: input.returnReason,
      openedById,
    },
    select: { id: true },
  });

  return { id: claim.id };
}

/* ─── getById ──────────────────────────────────────────────────────────── */

export async function getById(prisma: DbClient, id: string) {
  const claim = await prisma.returnClaim.findUnique({
    where: { id },
    include: CLAIM_INCLUDE,
  });
  if (!claim) {
    return null;
  }

  // Hydrate warranty info: deliveredAt + claimed line's effective warranty days
  const [shopSettings, deliveredAuditLog] = await Promise.all([
    prisma.shopSettings.findFirst({ select: { defaultWarrantyDays: true } }),
    prisma.auditLog.findFirst({
      where: {
        jobId: claim.originalJob.id,
        action: "STATUS_CHANGED",
        toValue: "DELIVERED",
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const defaultDays = shopSettings?.defaultWarrantyDays ?? 30;
  const claimedRepairId = claim.claimedJobRepair?.id ?? null;
  const claimedRepair = claim.originalJob.repairs.find(
    (r) => r.id === claimedRepairId
  );
  const claimedLineWarrantyDays =
    claimedRepair?.repair?.warrantyDays ?? defaultDays;

  const deliveredAt = deliveredAuditLog?.createdAt ?? null;
  const isInWarrantyAtOpen =
    deliveredAt === null
      ? false
      : (claim.openedAt.getTime() - deliveredAt.getTime()) / 86_400_000 <=
        claimedLineWarrantyDays;

  return {
    ...claim,
    warrantyInfo: {
      deliveredAt,
      claimedLineWarrantyDays,
      isInWarrantyAtOpen,
    },
  };
}

/* ─── list ─────────────────────────────────────────────────────────────── */

export async function list(prisma: DbClient, query: ListReturnClaimsQuery) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const where: Record<string, unknown> = {};
  if (query.status) {
    where.status = query.status;
  }
  if (query.faultCategory) {
    where.faultCategory = query.faultCategory;
  }
  if (query.resolutionOutcome) {
    where.resolutionOutcome = query.resolutionOutcome;
  }
  if (query.originalJobId) {
    where.originalJobId = query.originalJobId;
  }
  if (query.from || query.to) {
    where.openedAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }
  if (query.technicianId) {
    where.OR = [
      { originalJob: { technicianId: query.technicianId } },
      { reworkJob: { technicianId: query.technicianId } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.returnClaim.findMany({
      where,
      include: CLAIM_INCLUDE,
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.returnClaim.count({ where }),
  ]);

  return { items, total, page, limit };
}

/* ─── triage ───────────────────────────────────────────────────────────── */

export async function triage(
  prisma: DbClient,
  id: string,
  input: TriageInput
): Promise<ServiceResult<{ id: string }>> {
  const existing = await prisma.returnClaim.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) {
    return { error: "RETURN_CLAIM_NOT_FOUND" };
  }
  if (existing.status !== "OPEN") {
    return { error: "RETURN_CLAIM_NOT_OPEN" };
  }

  return await prisma.returnClaim.update({
    where: { id },
    data: { faultCategory: input.faultCategory },
  });
}

/* ─── spawnRework ──────────────────────────────────────────────────────── */

export async function spawnRework(
  prisma: DbClient,
  claimId: string,
  technicianId: string
): Promise<ServiceResult<{ claimId: string; reworkJobId: string }>> {
  return (await prisma.$transaction(async (tx) => {
    const claim = await tx.returnClaim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        status: true,
        reworkJobId: true,
        originalJobId: true,
        returnReason: true,
        originalJob: {
          select: {
            customerId: true,
            deviceId: true,
            device: {
              select: { brand: { select: { name: true } }, model: true },
            },
            customer: { select: { name: true, phone: true } },
          },
        },
      },
    });

    if (!claim) {
      return { error: "RETURN_CLAIM_NOT_FOUND" };
    }
    if (claim.status !== "OPEN") {
      return { error: "RETURN_CLAIM_NOT_OPEN" };
    }
    if (claim.reworkJobId) {
      return { error: "RETURN_CLAIM_HAS_REWORK_JOB" };
    }

    const reworkJobResult = await createJob(
      tx as unknown as PrismaClient,
      {
        customerId: claim.originalJob.customerId,
        customerName: claim.originalJob.customer.name,
        customerPhone: claim.originalJob.customer.phone,
        deviceBrand: claim.originalJob.device.brand.name,
        deviceModel: claim.originalJob.device.model,
        reportedProblem: `[Warranty rework] ${claim.returnReason}`,
        estimatedCost: 0,
        isWarrantyReturn: true,
        warrantyForJobId: claim.originalJobId,
      },
      technicianId,
      { prisma: tx as unknown as PrismaClient }
    );

    if (
      reworkJobResult &&
      typeof reworkJobResult === "object" &&
      "error" in reworkJobResult
    ) {
      return reworkJobResult;
    }

    const reworkJobId = (reworkJobResult as { id: string }).id;

    await tx.returnClaim.update({
      where: { id: claimId },
      data: { reworkJobId },
    });

    return { claimId, reworkJobId };
  })) as ServiceResult<{ claimId: string; reworkJobId: string }>;
}

/* ─── detachRework ─────────────────────────────────────────────────────── */

export async function detachRework(
  prisma: DbClient,
  claimId: string
): Promise<ServiceResult<{ id: string; reworkJobId: null }>> {
  const claim = await prisma.returnClaim.findUnique({
    where: { id: claimId },
    select: { id: true, status: true },
  });
  if (!claim) {
    return { error: "RETURN_CLAIM_NOT_FOUND" };
  }
  if (claim.status !== "OPEN") {
    return { error: "RETURN_CLAIM_NOT_OPEN" };
  }

  return (await prisma.returnClaim.update({
    where: { id: claimId },
    data: { reworkJobId: null },
    select: { id: true, reworkJobId: true },
  })) as ServiceResult<{ id: string; reworkJobId: null }>;
}

/* ─── resolve ──────────────────────────────────────────────────────────── */

const REWORK_OUTCOMES = new Set(["REWORK_FREE", "REWORK_PARTIAL_CHARGE"]);
const REFUND_OUTCOMES = new Set(["REFUND_PARTIAL", "REFUND_FULL"]);

export async function resolve(
  prisma: DbClient,
  claimId: string,
  input: ResolveInput,
  resolvedById: string
): Promise<ServiceResult<{ id: string; status: "RESOLVED" }>> {
  const claim = await prisma.returnClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      status: true,
      faultCategory: true,
      reworkJobId: true,
      originalJobId: true,
      originalJob: { select: { jobCode: true } },
      reworkJob: { select: { id: true, status: true } },
    },
  });

  if (!claim) {
    return { error: "RETURN_CLAIM_NOT_FOUND" };
  }
  if (claim.status !== "OPEN") {
    return { error: "RETURN_CLAIM_NOT_OPEN" };
  }
  if (!claim.faultCategory) {
    return { error: "RETURN_CLAIM_FAULT_REQUIRED" };
  }

  if (REWORK_OUTCOMES.has(input.resolutionOutcome)) {
    if (!(claim.reworkJobId && claim.reworkJob)) {
      return { error: "RETURN_CLAIM_REWORK_JOB_REQUIRED" };
    }
    if (claim.reworkJob.status !== "DELIVERED") {
      return { error: "RETURN_CLAIM_REWORK_JOB_NOT_DELIVERED" };
    }
  }

  if (REFUND_OUTCOMES.has(input.resolutionOutcome)) {
    if (claim.reworkJobId) {
      return { error: "RETURN_CLAIM_HAS_REWORK_JOB" };
    }
    // Cap the refund at money actually collected (deposit + payments),
    // never the estimate — the customer can only be refunded what they paid.
    const original = await prisma.job.findUnique({
      where: { id: claim.originalJobId },
      select: {
        depositAmount: true,
        payments: { select: { amount: true } },
      },
    });
    const totalReceived =
      Number(original?.depositAmount ?? 0) +
      (original?.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
    if ((input.refundAmount ?? 0) > totalReceived) {
      return { error: "REFUND_EXCEEDS_ORIGINAL" };
    }
  }

  const updated = await prisma.returnClaim.update({
    where: { id: claimId },
    data: {
      status: "RESOLVED",
      resolutionOutcome: input.resolutionOutcome,
      partialChargeAmount: input.partialChargeAmount ?? null,
      refundAmount: input.refundAmount ?? null,
      resolvedById,
      resolvedAt: new Date(),
    },
  });

  if (REFUND_OUTCOMES.has(input.resolutionOutcome)) {
    await notify({ prisma } as never, {
      eventName: "return_claim_resolved",
      jobId: claim.originalJobId,
      context: {
        jobCode: claim.originalJob.jobCode,
        outcome: input.resolutionOutcome,
      },
      recipients: { role: "OWNER" },
    });
  }

  return updated as ServiceResult<{ id: string; status: "RESOLVED" }>;
}

/* ─── uploadPhoto ──────────────────────────────────────────────────────── */

export async function uploadPhoto(
  prisma: DbClient,
  claimId: string,
  file: Parameters<typeof uploadJobPhoto>[2],
  stage: PhotoStage,
  userId: string
): Promise<ServiceResult<{ id: string; path: string }>> {
  const claim = await prisma.returnClaim.findUnique({
    where: { id: claimId },
    select: { id: true, status: true, originalJobId: true },
  });
  if (!claim) {
    return { error: "RETURN_CLAIM_NOT_FOUND" };
  }
  if (claim.status !== "OPEN") {
    return { error: "RETURN_CLAIM_NOT_OPEN" };
  }

  // The job is DELIVERED by definition of an open claim, so the job-level
  // mutability gate would always reject; the OPEN claim check above is the
  // correct guard for claim photos.
  const result = await uploadJobPhoto(
    prisma,
    claim.originalJobId,
    file,
    userId,
    { skipMutabilityCheck: true }
  );
  if (!result || (typeof result === "object" && "error" in result)) {
    return result as ServiceResult<{ id: string; path: string }>;
  }

  await prisma.jobPhoto.update({
    where: { id: result.id },
    data: { stage, returnClaimId: claimId },
  });

  return result;
}

/* ─── removePhoto ──────────────────────────────────────────────────────── */

export async function removePhoto(
  prisma: DbClient,
  claimId: string,
  photoId: string,
  userId: string
): Promise<ServiceResult<{ removed: true }>> {
  const claim = await prisma.returnClaim.findUnique({
    where: { id: claimId },
    select: { id: true, status: true, originalJobId: true },
  });
  if (!claim) {
    return { error: "RETURN_CLAIM_NOT_FOUND" };
  }
  if (claim.status !== "OPEN") {
    return { error: "RETURN_CLAIM_NOT_OPEN" };
  }

  const removed = await removeJobPhoto(
    prisma,
    claim.originalJobId,
    photoId,
    userId
  );
  if (!removed) {
    return { error: "RESOURCE_NOT_FOUND" };
  }
  return { removed: true };
}
