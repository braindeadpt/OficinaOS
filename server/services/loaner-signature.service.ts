import type { Prisma, PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  buildLoanerAgreementDocument,
  type LoanerAgreementDocument,
} from "@shared/loaner-agreement-document.js";
import type { FastifyBaseLogger } from "fastify";
import { createAuditLog } from "./audit.service.js";
import {
  publishSignatureRelay,
  REMOTE_SESSION_TTL_MS,
  remoteSignatureCreds,
} from "./signature-relay.service.js";
import {
  consumeLoanerSignatureSession,
  createSignatureSession,
} from "./signature-session.service.js";

// The loaner agreement signs through the same SignatureSession machinery as
// the intake ficha — same token shape, expiry and public /sign page — but as
// a second, independent document. The snapshot it freezes is the canonical
// LoanerAgreementDocument built HERE from the persisted job (never client
// input), so the customer can only sign what the server already holds.

const LOANER_SIGN_INCLUDE = {
  customer: true,
  device: { include: { brand: true } },
  loanerDevice: true,
} satisfies Prisma.JobInclude;

/**
 * Staff starts an agreement signing link for an existing job — QR on the LAN
 * plus a cloud-relayed URL when the shop is paired and entitled, mirroring
 * the intake session route.
 */
export async function createLoanerSignatureSession(
  prisma: PrismaClient,
  jobId: string,
  locale: string,
  log: FastifyBaseLogger
) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: LOANER_SIGN_INCLUDE,
  });
  if (!(job?.hasLoanerDevice && job.status !== "CANCELLED")) {
    throw new AppError("JOB_NOT_FOUND");
  }
  const document = buildLoanerAgreementDocument(job, locale);
  const session = await createSignatureSession(prisma, document);

  // Same pairing rules as the intake session: LAN 15 min by default, 30 min
  // only when the cloud actually accepted the relay copy.
  const relay = await remoteSignatureCreds(prisma);
  let cloudSignUrl: string | null = null;
  if (relay) {
    const remoteExpiresAt = new Date(Date.now() + REMOTE_SESSION_TTL_MS);
    cloudSignUrl = await publishSignatureRelay(
      relay,
      { document, expiresAt: remoteExpiresAt, token: session.token },
      log
    );
    if (cloudSignUrl) {
      await prisma.signatureSession.update({
        where: { token: session.token },
        data: { relayed: true, expiresAt: remoteExpiresAt },
      });
      session.expiresAt = remoteExpiresAt;
    }
  }
  return { ...session, cloudSignUrl };
}

/**
 * Moves a signed session onto the job: consume verifies the session is
 * signed and that the job still rebuilds the exact snapshot the customer
 * signed — a unit swap, note edit or customer change since the link was
 * made turns this into SIGNATURE_STALE instead of a dishonest document.
 */
export async function attachLoanerSignature(
  prisma: PrismaClient,
  jobId: string,
  token: string,
  userId: string
) {
  return await prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      include: LOANER_SIGN_INCLUDE,
    });
    if (!(job?.hasLoanerDevice && job.status !== "CANCELLED")) {
      throw new AppError("JOB_NOT_FOUND");
    }
    const session = await consumeLoanerSignatureSession(tx, token, job);
    const snapshot = session.snapshot as unknown as LoanerAgreementDocument;
    await tx.job.update({
      where: { id: job.id },
      data: {
        loanerAgreementSignatureDataUrl: session.signatureDataUrl,
        loanerAgreementDocumentHash: session.documentHash,
        loanerAgreementSignedAt: session.signedAt,
        loanerAgreementSignedVia: "remote",
        loanerAgreementSignerIp: session.signerIp,
        loanerAgreementSignerUserAgent: session.signerUserAgent,
        loanerAgreementSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    await createAuditLog(tx, {
      action: AuditAction.JOB_UPDATED,
      jobId: job.id,
      note: "loaner-agreement-signed",
      toValue: session.documentHash ?? undefined,
      userId,
    });
    return { ok: true };
  });
}
