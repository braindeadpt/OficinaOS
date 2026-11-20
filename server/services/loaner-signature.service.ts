import type { Prisma, PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  buildLoanerAgreementDocument,
  type LoanerAgreementDocument,
} from "@shared/loaner-agreement-document.js";
import { SIGNATURE_DATA_URL_RE } from "@shared/schemas/signature.schema.js";
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
  intakeDocumentHash,
  MAX_SIGNATURE_BYTES,
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

export interface AttachLoanerSignatureInput {
  /** In-person flow: the customer drew on the staff screen (XOR token). */
  signatureDataUrl?: string;
  /** Remote flow: the signed SignatureSession token (XOR signatureDataUrl). */
  token?: string;
}

interface AttachedSignatureFields {
  dataUrl: string;
  document: LoanerAgreementDocument;
  documentHash: string | null;
  signedAt: Date | null;
  signedVia: string;
  signerIp: string | null;
  signerUserAgent: string | null;
}

/**
 * Moves a signature onto the job. Remote path: consume verifies the session
 * is signed and that the job still rebuilds the exact snapshot the customer
 * signed — a unit swap, note edit or customer change since the link was
 * made turns this into SIGNATURE_STALE instead of a dishonest document.
 * In-person path: the document is rebuilt from the job inside this same
 * transaction, so the hash can only ever cover what the database holds.
 */
export async function attachLoanerSignature(
  prisma: PrismaClient,
  jobId: string,
  input: AttachLoanerSignatureInput,
  locale: string,
  userId: string
) {
  const signatureDataUrl =
    typeof input.signatureDataUrl === "string" ? input.signatureDataUrl : null;
  const token = typeof input.token === "string" ? input.token : null;
  if (
    (token === null) === (signatureDataUrl === null) ||
    (signatureDataUrl !== null &&
      !(
        SIGNATURE_DATA_URL_RE.test(signatureDataUrl) &&
        signatureDataUrl.length <= MAX_SIGNATURE_BYTES
      ))
  ) {
    throw new AppError("VALIDATION_ERROR");
  }

  return await prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      include: LOANER_SIGN_INCLUDE,
    });
    if (!(job?.hasLoanerDevice && job.status !== "CANCELLED")) {
      throw new AppError("JOB_NOT_FOUND");
    }

    const fields: AttachedSignatureFields = signatureDataUrl
      ? (() => {
          const document = buildLoanerAgreementDocument(job, locale);
          return {
            dataUrl: signatureDataUrl,
            document,
            documentHash: intakeDocumentHash(document, signatureDataUrl),
            signedAt: new Date(),
            signedVia: "in_person",
            signerIp: null,
            signerUserAgent: null,
          };
        })()
      : await (async () => {
          const session = await consumeLoanerSignatureSession(
            tx,
            token as string,
            job
          );
          return {
            dataUrl: session.signatureDataUrl as string,
            document: session.snapshot as unknown as LoanerAgreementDocument,
            documentHash: session.documentHash,
            signedAt: session.signedAt,
            signedVia: "remote",
            signerIp: session.signerIp,
            signerUserAgent: session.signerUserAgent,
          };
        })();

    await tx.job.update({
      where: { id: job.id },
      data: {
        loanerAgreementSignatureDataUrl: fields.dataUrl,
        loanerAgreementDocumentHash: fields.documentHash,
        loanerAgreementSignedAt: fields.signedAt,
        loanerAgreementSignedVia: fields.signedVia,
        loanerAgreementSignerIp: fields.signerIp,
        loanerAgreementSignerUserAgent: fields.signerUserAgent,
        loanerAgreementSnapshot:
          fields.document as unknown as Prisma.InputJsonValue,
      },
    });
    await createAuditLog(tx, {
      action: AuditAction.JOB_UPDATED,
      jobId: job.id,
      note: "loaner-agreement-signed",
      toValue: fields.documentHash ?? undefined,
      userId,
    });
    return { ok: true };
  });
}
