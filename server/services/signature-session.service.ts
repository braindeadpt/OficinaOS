import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  buildIntakeDocument,
  canonicalize,
  type IntakeDocument,
  type IntakeDocumentSource,
  publicDocumentView,
} from "@shared/intake-document.js";

// The QR is photographed easily and the bearer token is the only secret, so
// the window stays short — a fresh session is one click away in the modal.
const SESSION_TTL_MS = 15 * 60 * 1000;
const TOKEN_RE = /^[a-f0-9]{64}$/;
// canvas.toDataURL("image/png") output — a stroke on a mostly-blank canvas is
// tens of KB; 500 KB rejects anything that is not a real signature.
const MAX_SIGNATURE_BYTES = 500 * 1024;
const SIGNATURE_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** sha256 of the canonical document + the signature image — the job's proof. */
export function intakeDocumentHash(
  document: IntakeDocument,
  signatureDataUrl: string
): string {
  return createHash("sha256")
    .update(canonicalize(document))
    .update("\n")
    .update(signatureDataUrl)
    .digest("hex");
}

/** True when the submitted ficha still matches the frozen session document. */
export function documentMatches(
  snapshot: unknown,
  input: IntakeDocumentSource
): boolean {
  const frozen = snapshot as IntakeDocument | null;
  if (!frozen) {
    return false;
  }
  const rebuilt = buildIntakeDocument(input, frozen.termsText, frozen.locale);
  return canonicalize(rebuilt) === canonicalize(frozen);
}

export async function createSignatureSession(
  prisma: PrismaClient,
  document?: IntakeDocument
) {
  // Lazy cleanup — dead sessions hold a signature image and are worthless.
  await prisma.signatureSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  const session = await prisma.signatureSession.create({
    data: {
      token: randomBytes(32).toString("hex"),
      snapshot: (document ?? undefined) as Prisma.InputJsonValue | undefined,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token: session.token, expiresAt: session.expiresAt };
}

function assertUsableToken(token: string) {
  if (!TOKEN_RE.test(token)) {
    throw new AppError("NOT_FOUND");
  }
}

/**
 * Staff-side poll — returns the captured signature so the intake modal can
 * attach it to the form; the job then owns it via intakeSignatureDataUrl.
 */
export async function getSignatureSession(prisma: PrismaClient, token: string) {
  assertUsableToken(token);
  const session = await prisma.signatureSession.findUnique({
    where: { token },
  });
  if (!session) {
    throw new AppError("NOT_FOUND");
  }
  return {
    signed: session.signatureDataUrl !== null,
    signatureDataUrl: session.signatureDataUrl,
    expiresAt: session.expiresAt,
  };
}

/**
 * Public page bootstrap — the frozen document (redacted view) plus status,
 * never the signature itself. Missing and expired links look identical so
 * probing reveals nothing.
 */
export async function getPublicSignatureSession(
  prisma: PrismaClient,
  token: string
) {
  assertUsableToken(token);
  const session = await prisma.signatureSession.findUnique({
    where: { token },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new AppError("SIGNATURE_SESSION_EXPIRED");
  }
  return {
    signed: session.signatureDataUrl !== null,
    document: session.snapshot
      ? publicDocumentView(session.snapshot as unknown as IntakeDocument)
      : null,
  };
}

export async function submitSignatureSession(
  prisma: PrismaClient,
  token: string,
  signatureDataUrl: unknown,
  meta: { ip?: string; userAgent?: string } = {}
) {
  assertUsableToken(token);
  if (
    !(
      typeof signatureDataUrl === "string" &&
      SIGNATURE_DATA_URL_RE.test(signatureDataUrl) &&
      signatureDataUrl.length <= MAX_SIGNATURE_BYTES
    )
  ) {
    throw new AppError("VALIDATION_ERROR");
  }

  const session = await prisma.signatureSession.findUnique({
    where: { token },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new AppError("SIGNATURE_SESSION_EXPIRED");
  }
  if (session.signatureDataUrl !== null) {
    throw new AppError("SIGNATURE_ALREADY_SUBMITTED");
  }

  const snapshot = session.snapshot as unknown as IntakeDocument | null;
  const documentHash = snapshot
    ? intakeDocumentHash(snapshot, signatureDataUrl)
    : null;

  // Atomic single-use: two racing submits can't both claim the slot.
  const updated = await prisma.signatureSession.updateMany({
    where: { id: session.id, signatureDataUrl: null },
    data: {
      signatureDataUrl,
      documentHash,
      signedAt: new Date(),
      signerIp: meta.ip ?? null,
      signerUserAgent: meta.userAgent ?? null,
    },
  });
  if (updated.count === 0) {
    throw new AppError("SIGNATURE_ALREADY_SUBMITTED");
  }
  return { ok: true };
}

/**
 * Job intake consumes a signed session: the submitted ficha must still match
 * the frozen document — otherwise the customer signed something else and the
 * link is stale. On match the session row is deleted and its signature,
 * document hash and provenance move onto the job.
 */
export async function consumeSignatureSession(
  prisma: Pick<PrismaClient, "signatureSession">,
  token: string,
  input: IntakeDocumentSource
) {
  assertUsableToken(token);
  const session = await prisma.signatureSession.findUnique({
    where: { token },
  });
  if (!session || session.expiresAt < new Date()) {
    throw new AppError("SIGNATURE_SESSION_EXPIRED");
  }
  if (!(session.signatureDataUrl && session.signedAt)) {
    throw new AppError("VALIDATION_ERROR");
  }
  if (!documentMatches(session.snapshot, input)) {
    throw new AppError("SIGNATURE_STALE");
  }
  await prisma.signatureSession.delete({ where: { id: session.id } });
  return session;
}

/** Staff invalidates a session whose ficha changed after the link was made. */
export async function invalidateSignatureSession(
  prisma: PrismaClient,
  token: string
) {
  assertUsableToken(token);
  await prisma.signatureSession.deleteMany({ where: { token } });
  return { ok: true };
}
