import { createHash } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import { AppError, isAppError } from "@shared/errors/app-error.js";
import {
  type IntakeDocument,
  publicDocumentView,
} from "@shared/intake-document.js";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch, HINT_TTL_MS } from "./cloud.service.js";
import { submitSignatureSession } from "./signature-session.service.js";

// v1: the link is valid only while the intake dialog stays open — it exists
// for the customer standing at the counter. 30 minutes covers the interaction
// while keeping a forgotten link from staying signable into nothing. (Async
// "sign later" links are a separate, future design.)
export const REMOTE_SESSION_TTL_MS = 30 * 60 * 1000;
const MODULE = "signature-remote";
const TRAILING_SLASHES = /\/+$/;

/**
 * The cloud only ever sees the sha256 of the session token — the raw
 * credential stays on the shop side and inside the customer's own link.
 */
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface RelayCreds {
  apiUrl: string;
  token: string;
}

/**
 * Cloud credentials when the shop is paired AND the cached entitlements say
 * the signature-remote module is on. The hint is exactly that — the cloud
 * re-checks the entitlement on every call, so a stale cache can only waste
 * one publish attempt, never bypass the gate.
 */
export async function remoteSignatureCreds(
  prisma: PrismaClient
): Promise<RelayCreds | null> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    return null;
  }
  const fresh =
    settings.cloudSyncedAt &&
    Date.now() - settings.cloudSyncedAt.getTime() < HINT_TTL_MS;
  const modules =
    fresh && Array.isArray(settings.cloudEntitlements)
      ? (settings.cloudEntitlements as string[])
      : [];
  if (!modules.includes(MODULE)) {
    return null;
  }
  return {
    apiUrl: settings.cloudApiUrl,
    token: decryptSecret(settings.cloudShopTokenEncrypted),
  };
}

/**
 * Pairing-level credentials — apiUrl + shop token, WITHOUT the module
 * entitlement check. Only for cleanup paths (invalidate/delete): a revoked
 * module must never orphan a published session — the cloud row keeps
 * serving the document until its own expiry otherwise.
 */
export async function pairingSignatureCreds(
  prisma: PrismaClient
): Promise<RelayCreds | null> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    return null;
  }
  return {
    apiUrl: settings.cloudApiUrl,
    token: decryptSecret(settings.cloudShopTokenEncrypted),
  };
}

/**
 * Publish a session's frozen document to the cloud relay so the same token
 * resolves at cloud.oficinaos.app/sign/:token for customers off the LAN.
 * Returns the public URL, or null when the cloud declines/is unreachable —
 * the LAN QR stays the fallback either way.
 */
export async function publishSignatureRelay(
  creds: RelayCreds,
  input: { token: string; document: IntakeDocument; expiresAt: Date },
  log: FastifyBaseLogger
): Promise<string | null> {
  const res = await cloudFetch(creds.apiUrl, "/signature/sessions", {
    body: {
      document: JSON.parse(JSON.stringify(publicDocumentView(input.document))),
      expiresAt: input.expiresAt.toISOString(),
      tokenHash: tokenHash(input.token),
    },
    method: "POST",
    token: creds.token,
  }).catch(() => null);
  if (!res?.ok) {
    log.warn(
      { status: res?.status },
      "signature relay publish failed — LAN link stays the fallback"
    );
    return null;
  }
  return `${creds.apiUrl.replace(TRAILING_SLASHES, "")}/sign/${input.token}`;
}

/** Best-effort removal of the cloud copy after the session was invalidated. */
export async function deleteSignatureRelay(
  creds: RelayCreds,
  sessionToken: string,
  log: FastifyBaseLogger
): Promise<void> {
  const res = await cloudFetch(
    creds.apiUrl,
    `/signature/sessions/${tokenHash(sessionToken)}`,
    {
      method: "DELETE",
      token: creds.token,
    }
  ).catch(() => null);
  if (!res?.ok) {
    log.warn({ status: res?.status }, "signature relay delete failed");
  }
}

// The cloud stamps signedAt when the customer submits — the poller can lag
// for hours, so the stored signature must keep the customer's own moment.
// Only finite, non-future values are trusted (small skew tolerated); a
// bogus stamp falls back to receive time inside submitSignatureSession.
const CLOCK_SKEW_MS = 60_000;
function validatedReplyTime(signedAt: string | undefined): Date | undefined {
  if (!signedAt) {
    return;
  }
  const t = Date.parse(signedAt);
  if (!Number.isFinite(t) || t > Date.now() + CLOCK_SKEW_MS) {
    return;
  }
  return new Date(t);
}

interface SignatureReply {
  signatureDataUrl?: string;
  signedAt?: string;
  signerIp?: string | null;
  signerUserAgent?: string | null;
  tokenHash?: string;
}

/**
 * Pull completed signatures from the cloud relay into the matching local
 * sessions — the dialog's normal poll then picks them up unchanged. The
 * cloud stores only sha256(token), so replies are matched by hashing each
 * local session's token. Every processed reply is acked so the cloud drops
 * its row and stops resending — including replies whose local session is
 * already gone, which can never land anywhere.
 */
export async function pullSignatureReplies(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/signature/replies", { token });
  if (!res.ok) {
    log.warn({ status: res.status }, "signature replies fetch failed");
    return;
  }
  const replies = ((res.body as { replies?: SignatureReply[] }).replies ??
    []) as SignatureReply[];

  const localTokens = await prisma.signatureSession.findMany({
    select: { token: true },
  });
  const tokenByHash = new Map(
    localTokens.map((s) => [tokenHash(s.token), s.token])
  );

  const acked: string[] = [];
  for (const reply of replies) {
    if (!(reply.tokenHash && reply.signatureDataUrl)) {
      continue;
    }
    const localToken = tokenByHash.get(reply.tokenHash);
    try {
      if (!localToken) {
        throw new AppError("NOT_FOUND");
      }
      await submitSignatureSession(prisma, localToken, reply.signatureDataUrl, {
        ip: reply.signerIp ?? undefined,
        userAgent: reply.signerUserAgent ?? undefined,
        signedAt: validatedReplyTime(reply.signedAt),
      });
      acked.push(reply.tokenHash);
    } catch (err) {
      // AppError = the local session is gone, expired or already signed —
      // the cloud can't deliver it anywhere else, so ack and move on.
      // Anything else (DB down) stays un-acked for the next sync.
      if (isAppError(err)) {
        log.warn(
          { code: err.code },
          "signature reply dropped — local session unusable"
        );
        acked.push(reply.tokenHash);
      } else {
        log.warn({ err }, "signature reply import failed");
      }
    }
  }

  if (acked.length) {
    const ack = await cloudFetch(apiUrl, "/signature/replies/ack", {
      body: { tokenHashes: acked },
      method: "POST",
      token,
    });
    if (!ack.ok) {
      log.warn({ status: ack.status }, "signature replies ack failed");
    }
    log.info({ pulled: acked.length }, "signature replies pulled");
  }
}
