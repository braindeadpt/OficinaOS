import { AuditAction } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { IntakeDocument } from "@shared/intake-document.js";
import {
  LOANER_AGREEMENT_DOC_KIND,
  type LoanerAgreementDocument,
  loanerAgreementMatches,
} from "@shared/loaner-agreement-document.js";
import { resolveRemoteSignUrl } from "../lib/remote-sign-url.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { isModuleEnabled } from "../utils/modules.js";
import { createAuditLog } from "./audit.service.js";
import { notify } from "./notification-dispatch.js";
import { getSmsDeviceStatus } from "./sms-cloud.service.js";
import { resolveWhatsAppChannel } from "./whatsapp-channel.js";

// Sending a signing link is a staff-initiated action: the employee at the
// counter would otherwise copy the URL into the shop's own WhatsApp or an
// SMS by hand. It is therefore a transactional service message — the
// customer is expecting it, it fires once per click and the link expires
// with the session — so it rides the notification pipeline under the
// STAFF_INITIATED_TEMPLATES exemption (skips the opt-in gate, still obeys
// the channel toggles). Marketing-style events keep the consent gate.
export const SIGNATURE_LINK_EVENT = "signature_link";

// The message is rendered inside an editable template, but the document
// name itself must follow the frozen document's language — a PT agreement
// must not produce "assine the loaner agreement". Falls back to PT, the
// product default, for unknown locales.
const DOC_LABELS: Record<string, { intake: string; loaner: string }> = {
  en: { intake: "the intake form", loaner: "the loaner agreement" },
  es: { intake: "la ficha de admisión", loaner: "el acuerdo de préstamo" },
  fr: { intake: "la fiche d'admission", loaner: "le contrat de prêt" },
  pt: { intake: "a ficha de receção", loaner: "o termo de responsabilidade" },
};

const NON_DIGIT_RE = /\D/g;

const maskPhone = (phone: string) =>
  `•••${phone.replace(NON_DIGIT_RE, "").slice(-4)}`;

/**
 * Canal utilizável para o link — do canal do PRÓPRIO template. O
 * dispatch só enfileira pelos canais dos modelos `signature_link`:
 * ter WhatsApp ligado não chega quando a loja moveu o modelo para
 * SMS sem transporte SMS (e vice-versa) — a confirmação saía sem
 * mensagem nenhuma na fila. O corpo WhatsApp serve também o fallback
 * SMS do dispatch quando não há modelo SMS específico.
 */
async function signatureChannelReady(
  prisma: DbClient,
  settings: Awaited<ReturnType<typeof findShopSettingsUnique>>
): Promise<boolean> {
  const templates = await prisma.notificationTemplate.findMany({
    select: { channel: true },
    where: { name: SIGNATURE_LINK_EVENT },
  });
  const hasWa = templates.some((t) => t.channel === "WHATSAPP");
  // Decisão 2026-11-23: toda a mensagem é Pro — o canal só conta como
  // utilizável com o módulo correspondente ativo (cache <24h). Sem ele
  // o diálogo falha com SIGNATURE_LINK_NO_CHANNEL em vez de confirmar
  // um envio que ficaria para sempre na fila.
  if (hasWa && settings && resolveWhatsAppChannel(settings)) {
    return true;
  }
  const hasSms = templates.some((t) => t.channel === "SMS");
  if (!(hasSms || hasWa)) {
    return false;
  }
  if (!isModuleEnabled(settings, "sms")) {
    return false;
  }
  if (settings?.smsEnabled) {
    return true;
  }
  // Subscrição Pro sem device enabled na Cloud devolvia DEVICE_MISSING
  // depois de o diálogo confirmar o envio.
  return (await getSmsDeviceStatus(prisma)).sendable;
}

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
  let isLoanerDoc = false;
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
    isLoanerDoc = true;
  }

  // The frozen document carries the language the customer saw — the label
  // inserted into the template follows it, not the staff member's locale.
  const docLocale = (snapshot as { locale?: string }).locale ?? "pt";
  const labels = DOC_LABELS[docLocale] ?? DOC_LABELS.pt;
  const docLabel = isLoanerDoc ? labels.loaner : labels.intake;

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
  if (!(await signatureChannelReady(app.prisma, settings))) {
    throw new AppError("SIGNATURE_LINK_NO_CHANNEL");
  }

  const ttlMinutes = Math.max(
    1,
    Math.round((session.expiresAt.getTime() - Date.now()) / 60_000)
  );
  await notify(app, {
    // The link dies with the session — a retry landing after expiry would
    // deliver a dead URL, so the outbox entries carry the same deadline.
    deliverBy: session.expiresAt,
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
