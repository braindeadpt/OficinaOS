import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

export function findJobWithPayments(prisma: DbClient, jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      depositAmount: true,
      paymentOnDeliveryMethod: true,
      payments: {
        select: { amount: true },
        orderBy: { createdAt: "asc" as const },
      },
      partsUsed: { select: { totalCost: true } },
      repairs: { select: { price: true } },
    },
  });
}

export function findPaymentWithJob(prisma: DbClient, paymentId: string) {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: { job: { select: { id: true, status: true } } },
  });
}

export function createPayment(
  prisma: DbClient,
  data: Prisma.PaymentCreateInput
) {
  return prisma.payment.create({ data });
}

export function deletePaymentById(prisma: DbClient, paymentId: string) {
  return prisma.payment.delete({ where: { id: paymentId } });
}
