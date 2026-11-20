import { AuditAction } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { IntakeDocument } from "@shared/intake-document.js";
import {
  LOANER_AGREEMENT_DOC_KIND,
  type LoanerAgreementDocument,
  loanerAgreementMatches,
} from "@shared/loaner-agreement-document.js";
import { loadEnv } from "../config/env.js";
import { accessUrls } from "../lib/mdns.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { createAuditLog } from "./audit.service.js";
import { notify } from "./notification-dispatch.js";

// Sending a signing link is a staff-initiated action: the employee at the
// counter would otherwise copy the URL into the shop's own WhatsApp or an
// SMS by hand. It is therefore a transactional service message — the
// customer is expecting it, it fires once per click and the link expires
// with the session — so it rides the notification pipeline under the
// STAFF_INITIATED_TEMPLATES exemption (skips the opt-in gate, still obeys
// the channel toggles). Marketing-style events keep the consent gate.
export const SIGNATURE_LINK_EVENT = "signature_link";

const TRAILING_SLASH_RE = /\/+$/;
const IPV4_HOST_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const NON_DIGIT_RE = /\D/g;

/**
 * True when a base URL can be opened from a phone outside the shop network.
 * Mirrors the public/undialable rules in src/.../remote-signature-url.ts —
 * a public hostname, public IP or https tunnel qualifies; LAN IPs, .local
 * names, loopback and CGNAT ranges do not.
 */
function isRemoteUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "[::]"
  ) {
    return false;
  }
  const m = IPV4_HOST_RE.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return false;
    }
  } else if (!host.includes(".")) {
    // Bare machine hostnames resolve via NetBIOS/mDNS on the LAN only —
    // they dead-end the moment the phone leaves the shop network.
    return false;
  }
  return true;
}

/**
 * The URL that goes into the message must be the same one the QR encodes:
 * the cloud relay when the session was published there, otherwise a public
 * base the shop exposes itself (trackingBaseUrl first — it is the
 * customer-facing address — then APP_URL from the access-info list).
 */
async function resolveRemoteSignUrl(
  prisma: DbClient,
  session: { relayed: boolean; token: string }
): Promise<string | null> {
  const settings = await findShopSettingsUnique(prisma);
  if (session.relayed && settings?.cloudApiUrl) {
    return `${settings.cloudApiUrl.replace(TRAILING_SLASH_RE, "")}/sign/${session.token}`;
  }
  const candidates: string[] = [];
  if (settings?.trackingBaseUrl) {
    candidates.push(settings.trackingBaseUrl);
  }
  const env = loadEnv();
  candidates.push(
    ...accessUrls({
      appUrl: env.APP_URL,
      mdnsHostname: env.MDNS_HOSTNAME,
      port: env.PORT,
    }).urls
  );
  const base = candidates.find(isRemoteUrl);
  return base
    ? `${base.replace(TRAILING_SLASH_RE, "")}/sign/${session.token}`
    : null;
}

const maskPhone = (phone: string) =>
  `•••${phone.replace(NON_DIGIT_RE, "").slice(-4)}`;

/**
 * Staff clicks "send the link": the live session's frozen document carries
 * the customer phone (intake) or the loaner job (verified against drift so
 * a stale link is never sent). Dispatches through the normal outbox —
 * WhatsApp and/or SMS depending on the enabled channels — and leaves an
 * audit trail with the masked recipient, never the bearer URL itself.
 */
export async function sendSignatureLink(
  app: {
    prisma: DbClient;
    wsBroadcast?: (
      predicate: (c: { role: string; userId: string }) => boolean,
      payload: Record<string, unknown>
    ) => void;
  },
  token: string,
  staffUserId: string
): Promise<{ sent: true }> {
  const session = await app.prisma.signatureSession.findUnique({
    where: { token },
  });
  if (!session) {
    throw new AppError("NOT_FOUND");
  }
  if (session.expiresAt < new Date()) {
    throw new AppError("SIGNATURE_SESSION_EXPIRED");
  }
  if (session.signatureDataUrl !== null) {
    throw new AppError("SIGNATURE_ALREADY_SUBMITTED");
  }

  const snapshot = session.snapshot as
    | IntakeDocument
    | LoanerAgreementDocument
    | null;
  if (!snapshot) {
    throw new AppError("VALIDATION_ERROR");
  }

  let jobId: string | undefined;
  let jobCode: string | undefined;
  let docLabel: string;
  if ((snapshot as LoanerAgreementDocument).doc === LOANER_AGREEMENT_DOC_KIND) {
    const loanerDoc = snapshot as LoanerAgreementDocument;
    const job = await app.prisma.job.findUnique({
      where: { jobCode: loanerDoc.jobCode },
      include: {
        customer: true,
        device: { include: { brand: true } },
        loanerDevice: true,
      },
    });
    if (!job) {
      throw new AppError("JOB_NOT_FOUND");
    }
    // The job changed after the link was minted — the customer would sign
    // a document the attach step would then reject as stale.
    if (!loanerAgreementMatches(loanerDoc, job)) {
      throw new AppError("SIGNATURE_STALE");
    }
    jobId = job.id;
    jobCode = job.jobCode;
    docLabel = "the loaner agreement";
  } else {
    docLabel = "the intake form";
  }

  const phone = snapshot.customerPhone?.trim();
  if (!phone) {
    throw new AppError("VALIDATION_ERROR");
  }

  const signUrl = await resolveRemoteSignUrl(app.prisma, {
    relayed: session.relayed,
    token,
  });
  if (!signUrl) {
    throw new AppError("SIGNATURE_LINK_NO_REMOTE");
  }

  const settings = await findShopSettingsUnique(app.prisma);
  // SMS local (gateway Android) é free — o módulo "sms" gateia só os
  // transportes geridos futuros, não o gateway da loja.
  const smsReady = Boolean(settings?.smsEnabled);
  if (!(settings?.whatsappEnabled || smsReady)) {
    throw new AppError("SIGNATURE_LINK_NO_CHANNEL");
  }

  const ttlMinutes = Math.max(
    1,
    Math.round((session.expiresAt.getTime() - Date.now()) / 60_000)
  );
  await notify(app, {
    eventName: SIGNATURE_LINK_EVENT,
    jobId,
    context: {
      customerName: snapshot.customerName,
      docLabel,
      jobCode,
      recipientPhone: phone,
      signUrl,
      ttlMinutes: String(ttlMinutes),
    },
    recipients: { userIds: [staffUserId] },
  });
  await createAuditLog(app.prisma, {
    action: AuditAction.NOTIFICATION_SENT,
    jobId: jobId ?? null,
    metadata: {
      doc:
        (snapshot as LoanerAgreementDocument).doc === LOANER_AGREEMENT_DOC_KIND
          ? "loaner-agreement"
          : "intake",
      recipientPhone: maskPhone(phone),
    },
    note: "signature-link-sent",
    userId: staffUserId,
  });
  return { sent: true };
}
