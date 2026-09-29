import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import { JobStatus } from "@shared/constants/job-statuses";
import { AppError } from "@shared/errors/app-error.js";
import type {
  AddPaymentInput,
  PaymentOnDeliveryMethodType,
} from "@shared/schemas/payment.schema";
import { update as jobUpdate } from "../repositories/job.repository.js";
import {
  createPayment as createPaymentRepo,
  deletePaymentById,
  findJobWithPayments,
  findPaymentWithJob,
} from "../repositories/payment.repository.js";
import { createAuditLog } from "./audit.service.js";

export interface JobBalance {
  balanceDue: number;
  paidTotal: number;
}

/**
 * Balance due = (parts + repairs) - deposit - payments.
 * Negative totals (e.g. refund lines) are floored at zero for display.
 */
export function computeJobBalance(job: {
  depositAmount?: { toNumber: () => number } | null;
  payments?: { amount: { toNumber: () => number } }[];
  partsUsed: { totalCost: { toNumber: () => number } }[];
  repairs: { price: { toNumber: () => number } }[];
}): JobBalance {
  const partsSum = job.partsUsed.reduce(
    (s, p) => s + p.totalCost.toNumber(),
    0
  );
  const repairsSum = job.repairs.reduce((s, r) => s + r.price.toNumber(), 0);
  const paidTotal = (job.payments ?? []).reduce(
    (s, p) => s + p.amount.toNumber(),
    0
  );
  const deposit = job.depositAmount?.toNumber() ?? 0;
  const balanceDue = Math.max(0, partsSum + repairsSum - deposit - paidTotal);
  return { balanceDue, paidTotal };
}

// Payments are allowed on delivered jobs (customers often pay on pickup),
// but never on cancelled or returned jobs.
function isPaymentBlocked(status: string): boolean {
  return status === "CANCELLED" || status === "RETURNED";
}

export async function listForJob(prisma: PrismaClient, jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true },
  });
  if (!job) {
    return null;
  }
  const [payments, agg] = await prisma.$transaction([
    prisma.payment.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
      },
    }),
    prisma.payment.aggregate({
      where: { jobId },
      _sum: { amount: true },
    }),
  ]);
  return { paidTotal: agg._sum.amount?.toNumber() ?? 0, payments };
}

export async function add(
  prisma: PrismaClient,
  jobId: string,
  input: AddPaymentInput,
  userId: string
) {
  const job = await findJobWithPayments(prisma, jobId);
  if (!job) {
    return null;
  }
  if (isPaymentBlocked(job.status)) {
    return { error: "JOB_IN_TERMINAL_STATUS" as const };
  }

  const { balanceDue } = computeJobBalance(job);
  if (input.amount > balanceDue) {
    return { error: "PAYMENT_EXCEEDS_BALANCE" as const, balanceDue };
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      // Serialize concurrent checkouts on this job and re-read the balance
      // under the lock. The pre-transaction check above is advisory: without
      // the row lock two payments could both validate against the same stale
      // figure and overpay the job.
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const fresh = await tx.job.findUnique({
        where: { id: jobId },
        select: {
          depositAmount: true,
          payments: { select: { amount: true } },
          partsUsed: { select: { totalCost: true } },
          repairs: { select: { price: true } },
        },
      });
      if (!fresh) {
        throw new AppError("JOB_NOT_FOUND");
      }
      const { balanceDue: current } = computeJobBalance(fresh);
      if (input.amount > current) {
        throw new AppError("PAYMENT_EXCEEDS_BALANCE", { balanceDue: current });
      }

      const created = await createPaymentRepo(tx, {
        amount: input.amount,
        job: { connect: { id: jobId } },
        method: input.method,
        note: input.note ?? null,
        reference: input.reference ?? null,
        createdBy: { connect: { id: userId } },
      });

      await createAuditLog(tx, {
        action: AuditAction.PAYMENT_ADDED,
        jobId,
        metadata: {
          method: input.method,
          paymentId: created.id,
          reference: input.reference ?? null,
        },
        toValue: `${input.amount} ${input.method}`,
        userId,
      });

      return created;
    });

    return payment;
  } catch (error) {
    if (error instanceof AppError && error.code === "PAYMENT_EXCEEDS_BALANCE") {
      const details = error.details as { balanceDue?: number } | undefined;
      if (details?.balanceDue !== undefined) {
        return {
          error: "PAYMENT_EXCEEDS_BALANCE" as const,
          balanceDue: details.balanceDue,
        };
      }
      return { error: "PAYMENT_EXCEEDS_BALANCE" as const };
    }
    throw error;
  }
}

export async function remove(
  prisma: PrismaClient,
  jobId: string,
  paymentId: string,
  userId: string
) {
  const payment = await findPaymentWithJob(prisma, paymentId);
  if (!payment || payment.job.id !== jobId) {
    return { error: "PAYMENT_NOT_FOUND" as const };
  }
  // Removal must be possible after delivery (corrections on paid-out jobs).
  if (isPaymentBlocked(payment.job.status)) {
    return { error: "JOB_IN_TERMINAL_STATUS" as const };
  }

  await prisma.$transaction(async (tx) => {
    await deletePaymentById(tx, paymentId);
    await createAuditLog(tx, {
      action: AuditAction.PAYMENT_DELETED,
      fromValue: `${payment.amount} ${payment.method}`,
      jobId,
      metadata: { paymentId },
      userId,
    });
  });

  return true;
}

// ─── Paid-on-delivery (one click) ────────────────────────────────────
// Marking stores only the chosen method; the actual Payment row is
// created automatically when the job reaches DELIVERED (settle below).

export async function setPaymentOnDelivery(
  prisma: PrismaClient,
  jobId: string,
  method: PaymentOnDeliveryMethodType,
  userId: string
) {
  const job = await findJobWithPayments(prisma, jobId);
  if (!job) {
    return null;
  }
  if (isPaymentBlocked(job.status)) {
    return { error: "JOB_IN_TERMINAL_STATUS" as const };
  }
  if (job.paymentOnDeliveryMethod) {
    return { error: "PAYMENT_ON_DELIVERY_ALREADY_MARKED" as const };
  }
  const { balanceDue } = computeJobBalance(job);
  if (balanceDue <= 0) {
    return { error: "NO_PAYMENT_DUE" as const };
  }

  await prisma.$transaction(async (tx) => {
    await jobUpdate(tx, jobId, { paymentOnDeliveryMethod: method }, {});
    await createAuditLog(tx, {
      action: AuditAction.JOB_UPDATED,
      jobId,
      metadata: { autoSource: "PAYMENT_ON_DELIVERY" },
      toValue: method,
      userId,
    });
  });

  return { balanceDue, method };
}

export async function clearPaymentOnDelivery(
  prisma: PrismaClient,
  jobId: string,
  userId: string
) {
  const job = await findJobWithPayments(prisma, jobId);
  if (!job) {
    return null;
  }
  if (!job.paymentOnDeliveryMethod) {
    return { error: "PAYMENT_ON_DELIVERY_NOT_MARKED" as const };
  }

  await prisma.$transaction(async (tx) => {
    await jobUpdate(tx, jobId, { paymentOnDeliveryMethod: null }, {});
    await createAuditLog(tx, {
      action: AuditAction.JOB_UPDATED,
      fromValue: job.paymentOnDeliveryMethod ?? undefined,
      jobId,
      metadata: { autoSource: "PAYMENT_ON_DELIVERY" },
      userId,
    });
  });

  return true;
}

/**
 * Deliver-time hook: when a job marked as paid-on-delivery reaches
 * DELIVERED, record the outstanding balance as a payment and clear the
 * flag — atomically. Skips silently when not marked, not delivered, or
 * when there is nothing left to collect.
 */
export async function settlePaymentOnDelivery(
  prisma: PrismaClient,
  jobId: string,
  userId: string
): Promise<void> {
  const job = await findJobWithPayments(prisma, jobId);
  if (!job?.paymentOnDeliveryMethod || job.status !== JobStatus.DELIVERED) {
    return;
  }
  const method = job.paymentOnDeliveryMethod as PaymentOnDeliveryMethodType;
  const { balanceDue } = computeJobBalance(job);
  if (balanceDue <= 0) {
    // Nothing to collect: just clear the stale mark.
    await jobUpdate(prisma, jobId, { paymentOnDeliveryMethod: null }, {});
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Same lock-and-recheck as `add`: the delivery transition and a manual
    // payment can race, and only the serialized balance may be settled.
    await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
    const fresh = await tx.job.findUnique({
      where: { id: jobId },
      select: {
        depositAmount: true,
        payments: { select: { amount: true } },
        partsUsed: { select: { totalCost: true } },
        repairs: { select: { price: true } },
      },
    });
    if (!fresh) {
      throw new AppError("JOB_NOT_FOUND");
    }
    const { balanceDue: current } = computeJobBalance(fresh);
    if (current <= 0) {
      // Settled by someone else in the meantime: clear the stale mark only.
      await jobUpdate(tx, jobId, { paymentOnDeliveryMethod: null }, {});
      return;
    }

    const created = await createPaymentRepo(tx, {
      amount: current,
      job: { connect: { id: jobId } },
      method,
      note: null,
      reference: null,
      createdBy: { connect: { id: userId } },
    });

    await createAuditLog(tx, {
      action: AuditAction.PAYMENT_ADDED,
      jobId,
      metadata: {
        autoSource: "PAYMENT_ON_DELIVERY",
        method,
        paymentId: created.id,
      },
      toValue: `${current} ${method}`,
      userId,
    });

    await jobUpdate(tx, jobId, { paymentOnDeliveryMethod: null }, {});
  });
}
