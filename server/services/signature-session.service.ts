import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";

// The QR is photographed easily and the bearer token is the only secret, so
// the window stays short — a fresh session is one click away in the modal.
const SESSION_TTL_MS = 15 * 60 * 1000;
const TOKEN_RE = /^[a-f0-9]{64}$/;
// canvas.toDataURL("image/png") output — a stroke on a mostly-blank canvas is
// tens of KB; 500 KB rejects anything that is not a real signature.
const MAX_SIGNATURE_BYTES = 500 * 1024;
const SIGNATURE_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export async function createSignatureSession(prisma: PrismaClient) {
  // Lazy cleanup — dead sessions hold a signature image and are worthless.
  await prisma.signatureSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  const session = await prisma.signatureSession.create({
    data: {
      token: randomBytes(32).toString("hex"),
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
 * Public page bootstrap — status only, never the signature itself. Missing
 * and expired links look identical so probing reveals nothing.
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
  return { signed: session.signatureDataUrl !== null };
}

export async function submitSignatureSession(
  prisma: PrismaClient,
  token: string,
  signatureDataUrl: unknown
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

  // Atomic single-use: two racing submits can't both claim the slot.
  const updated = await prisma.signatureSession.updateMany({
    where: { id: session.id, signatureDataUrl: null },
    data: { signatureDataUrl },
  });
  if (updated.count === 0) {
    throw new AppError("SIGNATURE_ALREADY_SUBMITTED");
  }
  return { ok: true };
}
