import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import type { AddPaymentInput } from "@shared/schemas/payment.schema";
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

  const payment = await prisma.$transaction(async (tx) => {
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
