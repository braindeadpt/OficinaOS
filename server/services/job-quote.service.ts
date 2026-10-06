import type { JobQuote, PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import { QuoteStatus } from "@shared/constants/quote-statuses";
import { Role } from "@shared/constants/roles";
import type { SendQuoteInput } from "@shared/schemas/quote.schema";
import {
  createQuote,
  findJobByTrackingCode,
  findJobForQuote,
  findLatestQuote,
  findManyQuotes,
  findQuoteForJob,
  recordQuoteResponse,
  supersedeSentQuotes,
} from "../repositories/job-quote.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";
import { createAuditLog } from "./audit.service.js";
import type { NotifyContext } from "./job.service.js";
import { notify } from "./notification-dispatch.js";

export async function listQuotes(prisma: DbClient, jobId: string) {
  const job = await findJobForQuote(prisma, jobId);
  if (!job) {
    return null;
  }
  return findManyQuotes(prisma, jobId);
}

export async function createAndSendQuote(
  prisma: DbClient,
  jobId: string,
  input: SendQuoteInput,
  userId: string,
  notifyCtx: NotifyContext
): Promise<JobQuote | null> {
  const job = await findJobForQuote(prisma, jobId);
  if (!job) {
    return null;
  }

  const amount = input.amount ?? job.estimatedCost;

  const quote = await prisma.$transaction(async (tx) => {
    // Resend flow: a new quote retires the currently-pending one so the
    // customer can only ever answer the latest version.
    await supersedeSentQuotes(tx, jobId);
    const latest = await findLatestQuote(tx, jobId);
    return createQuote(tx, {
      job: { connect: { id: jobId } },
      version: (latest?.version ?? 0) + 1,
      amount,
      note: input.note ?? null,
      status: QuoteStatus.SENT,
    });
  });

  await createAuditLog(prisma, {
    action: AuditAction.QUOTE_SENT,
    jobId,
    toValue: `v${quote.version} — ${quote.amount}`,
    metadata: { quoteId: quote.id, version: quote.version },
    userId,
  });

  // The whole point of sending a quote is that the customer learns about
  // it — consent-gated WhatsApp carries the tracking deep link when the
  // shop has a public base URL configured.
  notify(notifyCtx, {
    context: {
      customerName: job.customer?.name,
      jobCode: job.jobCode,
      quoteAmount: quote.amount.toNumber().toFixed(2),
      recipientPhone: job.customer?.phone,
    },
    eventName: "quote_sent",
    jobId,
    recipients: { role: Role.OWNER },
  }).catch((err) => {
    logger.warn(
      { err, eventName: "quote_sent", jobId },
      "notify dispatch failed"
    );
  });

  return quote;
}

export interface QuoteRespondInput {
  code: string;
  decision: "approve" | "reject";
  note?: string;
  phone4: string;
  quoteId: string;
}

export interface QuoteRespondResult {
  error?:
    | "PHONE_MISMATCH"
    | "QUOTE_NOT_FOUND"
    | "QUOTE_SUPERSEDED"
    | "QUOTE_ALREADY_RESPONDED";
  jobExists: boolean;
  quote?: JobQuote;
}

export async function respondToQuote(
  prisma: PrismaClient,
  input: QuoteRespondInput,
  notifyCtx: NotifyContext
): Promise<QuoteRespondResult> {
  const job = await findJobByTrackingCode(prisma, input.code);
  if (!job) {
    return { jobExists: false };
  }

  // Same identity proof as /api/jobs/lookup: the last four digits of the
  // customer's stored phone. A miss must stay indistinguishable from an
  // unknown job code — the route maps both to JOB_NOT_FOUND.
  const storedPhone = job.customer.phone;
  const normalized = storedPhone ? storedPhone.replace(/\D/g, "") : "";
  if (normalized.length < 4 || normalized.slice(-4) !== input.phone4) {
    return { error: "PHONE_MISMATCH", jobExists: true };
  }

  const quote = await findQuoteForJob(prisma, job.id, input.quoteId);
  if (!quote) {
    return { error: "QUOTE_NOT_FOUND", jobExists: true };
  }
  if (quote.status === QuoteStatus.SUPERSEDED) {
    return { error: "QUOTE_SUPERSEDED", jobExists: true };
  }
  if (quote.status !== QuoteStatus.SENT) {
    return { error: "QUOTE_ALREADY_RESPONDED", jobExists: true };
  }

  const newStatus =
    input.decision === "approve" ? QuoteStatus.APPROVED : QuoteStatus.REJECTED;

  // Guard against a concurrent resend/response: only flip the row if it is
  // still SENT. A zero count means we lost the race — re-read to report the
  // real outcome instead of double-recording.
  const { count } = await recordQuoteResponse(
    prisma,
    quote.id,
    newStatus,
    input.note ?? null
  );
  if (count === 0) {
    const current = await findQuoteForJob(prisma, job.id, quote.id);
    if (current?.status === QuoteStatus.SUPERSEDED) {
      return { error: "QUOTE_SUPERSEDED", jobExists: true };
    }
    return { error: "QUOTE_ALREADY_RESPONDED", jobExists: true };
  }

  const updated = (await findQuoteForJob(prisma, job.id, quote.id)) ?? quote;

  await createAuditLog(prisma, {
    action: AuditAction.QUOTE_RESPONDED,
    jobId: job.id,
    toValue: newStatus,
    note: input.note,
    metadata: {
      quoteId: quote.id,
      version: quote.version,
      decision: input.decision,
    },
    // The customer has no account; attribute the event to the job's creator
    // so the audit row still satisfies the required userId.
    userId: job.createdById,
  });

  notify(notifyCtx, {
    context: {
      customerName: job.customer.name,
      jobCode: job.jobCode,
      decision: input.decision,
    },
    eventName:
      input.decision === "approve" ? "quote_approved" : "quote_rejected",
    jobId: job.id,
    recipients: { userIds: [job.createdById] },
  }).catch((err) => {
    logger.warn(
      { err, eventName: `quote_${input.decision}`, jobId: job.id },
      "notify dispatch failed"
    );
  });

  return { jobExists: true, quote: updated };
}
