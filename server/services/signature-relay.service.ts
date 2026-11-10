import type { PrismaClient } from "@generated/client";
import { isAppError } from "@shared/errors/app-error.js";
import {
  type IntakeDocument,
  publicDocumentView,
} from "@shared/intake-document.js";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch, HINT_TTL_MS } from "./cloud.service.js";
import { submitSignatureSession } from "./signature-session.service.js";

// Remote sign links travel by WhatsApp/SMS — the customer may open one hours
// later, so relayed sessions outlive the 15-minute LAN QR. The cloud clamps
// anything above its own 7-day cap.
export const REMOTE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MODULE = "signature-remote";
const TRAILING_SLASHES = /\/+$/;

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
      token: input.token,
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
    `/signature/sessions/${sessionToken}`,
    {
      method: "DELETE",
      token: creds.token,
    }
  ).catch(() => null);
  if (!res?.ok) {
    log.warn({ status: res?.status }, "signature relay delete failed");
  }
}

interface SignatureReply {
  signatureDataUrl?: string;
  signedAt?: string;
  signerIp?: string | null;
  signerUserAgent?: string | null;
  token?: string;
}

/**
 * Pull completed signatures from the cloud relay into the matching local
 * sessions — the dialog's normal poll then picks them up unchanged. Each
 * delivered token is acked so the cloud drops its copy and stops resending.
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

  const acked: string[] = [];
  for (const reply of replies) {
    if (!(reply.token && reply.signatureDataUrl)) {
      continue;
    }
    try {
      await submitSignatureSession(
        prisma,
        reply.token,
        reply.signatureDataUrl,
        {
          ip: reply.signerIp ?? undefined,
          userAgent: reply.signerUserAgent ?? undefined,
        }
      );
      acked.push(reply.token);
    } catch (err) {
      // AppError = the local session is gone, expired or already signed —
      // the cloud can't deliver it anywhere else, so ack and move on.
      // Anything else (DB down) stays un-acked for the next sync.
      if (isAppError(err)) {
        log.warn(
          { code: err.code },
          "signature reply dropped — local session unusable"
        );
        acked.push(reply.token);
      } else {
        log.warn({ err }, "signature reply import failed");
      }
    }
  }

  if (acked.length) {
    const ack = await cloudFetch(apiUrl, "/signature/replies/ack", {
      body: { tokens: acked },
      method: "POST",
      token,
    });
    if (!ack.ok) {
      log.warn({ status: ack.status }, "signature replies ack failed");
    }
    log.info({ pulled: acked.length }, "signature replies pulled");
  }
}
