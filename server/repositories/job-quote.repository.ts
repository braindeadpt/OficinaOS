import type { Prisma, QuoteStatus } from "@generated/client";
import type { DbClient } from "./types.js";

export function findJobForQuote(prisma: DbClient, jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobCode: true,
      estimatedCost: true,
      customer: { select: { name: true, phone: true } },
    },
  });
}

export function findJobByTrackingCode(prisma: DbClient, jobCode: string) {
  return prisma.job.findFirst({
    where: { jobCode },
    select: {
      id: true,
      jobCode: true,
      createdById: true,
      customer: { select: { name: true, phone: true } },
    },
  });
}

export function findManyQuotes(prisma: DbClient, jobId: string) {
  return prisma.jobQuote.findMany({
    where: { jobId },
    orderBy: { version: "desc" },
  });
}

export function findLatestQuote(prisma: DbClient, jobId: string) {
  return prisma.jobQuote.findFirst({
    where: { jobId },
    orderBy: { version: "desc" },
  });
}

export function findQuoteForJob(prisma: DbClient, jobId: string, id: string) {
  return prisma.jobQuote.findFirst({ where: { id, jobId } });
}

export function supersedeSentQuotes(prisma: DbClient, jobId: string) {
  return prisma.jobQuote.updateMany({
    where: { jobId, status: "SENT" },
    data: { status: "SUPERSEDED" },
  });
}

export function createQuote(
  prisma: DbClient,
  data: Prisma.JobQuoteCreateInput
) {
  return prisma.jobQuote.create({ data });
}

// Conditional update: the where clause still requires SENT, so a concurrent
// response or supersession turns this into a no-op instead of overwriting.
export function recordQuoteResponse(
  prisma: DbClient,
  quoteId: string,
  status: QuoteStatus,
  responseNote: string | null
) {
  return prisma.jobQuote.updateMany({
    where: { id: quoteId, status: "SENT" },
    data: { status, respondedAt: new Date(), responseNote },
  });
}
