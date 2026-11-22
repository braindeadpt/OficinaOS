import { OutboxStatus } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import { decryptSecret } from "../lib/crypto.js";
import { findCustomerByPhone } from "../repositories/customer.repository.js";
import {
  createOutboxEntry,
  findManyOutboxEntries,
  findNotificationTemplateUnique,
  findOutboxEntryById,
  transitionOutboxEntry,
} from "../repositories/notification.repository.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";
import { renderTemplate } from "./notification-renderer.js";
import { formatPhone } from "./notification-sender.js";
import { decryptSmsConfig, type SendResult, sendSms } from "./sms.service.js";
import {
  type CloudCredentials,
  isDefinitiveCloudError,
  sendSmsViaCloud,
} from "./sms-cloud.service.js";
import {
  resolveWhatsAppChannel,
  sendWhatsAppTemplateVia,
  sendWhatsAppText,
  type WhatsAppChannel,
} from "./whatsapp-channel.js";
import {
  metaConditionalVars,
  orderedTemplateParams,
  syncWhatsAppTemplates,
  TEMPLATE_LANG,
} from "./whatsapp-templates.service.js";

/**
 * Events a staff member fires by hand for a specific customer — not
 * automated messaging. The signature link is the same action the staff
 * would take by copying it into the shop's own WhatsApp: the customer is
 * waiting for it, it is sent once per click and it expires with the
 * session. These still respect the channel toggles and provider config;
 * they skip only the opt-in consent flag, which exists to gate automated
 * notifications, not staff-initiated service messages.
 */
export const STAFF_INITIATED_TEMPLATES: ReadonlySet<string> = new Set([
  "signature_link",
]);

// Adiamento de entries cujo template Meta ainda não está APPROVED —
// re-tenta de meia em meia hora até a revisão resolver ou o deliverBy
// cortar (cancelIfExpired).
const TEMPLATE_DEFER_MS = 30 * 60 * 1000;

// Re-sync de estados Meta despoletado por entradas deferidas — no máximo
// uma vez por TEMPLATE_RESYNC_MIN_MS para não martelar a Graph a cada
// ciclo do poller.
const TEMPLATE_RESYNC_MIN_MS = 10 * 60 * 1000;
let lastTemplateResyncAt = 0;
const TRAILING_SLASHES_RE = /\/+$/;
const TEMPLATE_VAR_RE = /\{\{(\w+)\}\}/g;
const URLISH_VAR_RE = /url$/i;

function maybeResyncTemplates(prisma: DbClient): void {
  const now = Date.now();
  if (now - lastTemplateResyncAt < TEMPLATE_RESYNC_MIN_MS) {
    return;
  }
  lastTemplateResyncAt = now;
  syncWhatsAppTemplates(prisma)
    .then(() => expediteApprovedDeferred(prisma))
    .catch((err) => logger.warn({ err }, "outbox: template re-sync failed"));
}

/** Depois de um re-sync: entradas adiadas cujo template ficou APPROVED
 *  voltam já à fila — o deliverBy (ex.: sessão de assinatura) pode não
 *  esperar os 30 min do re-agendamento normal. */
async function expediteApprovedDeferred(prisma: DbClient): Promise<void> {
  const settings = await findShopSettingsUnique(prisma);
  const deferred = await prisma.notificationOutbox.findMany({
    select: { id: true, templateName: true },
    where: {
      channel: "WHATSAPP",
      error: { startsWith: "Template " },
      status: OutboxStatus.QUEUED,
    },
  });
  const ready = deferred.filter(
    (e) => templateStatusOf(settings, e.templateName) === "APPROVED"
  );
  if (ready.length > 0) {
    await prisma.notificationOutbox.updateMany({
      data: { nextRetryAt: new Date() },
      where: { id: { in: ready.map((e) => e.id) } },
    });
  }
}

/** Estado conhecido do template no último sync — null = sem registo. */
export function templateStatusOf(
  settings: ShopSettingsRow | null,
  name: string
): string | null {
  const raw = settings?.whatsappTemplatesJson;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = (raw as Record<string, { status?: unknown }>)[name];
  const s = typeof entry?.status === "string" ? entry.status : null;
  return s ? s.toUpperCase() : null;
}

/**
 * WhatsApp consent gate. Only customers who opted in may receive messages;
 * the shop's own phone is always allowed (test notifications, shop contact).
 * Returns null when the send must be skipped, with a human-readable reason.
 */
export async function assertWhatsAppConsent(
  prisma: DbClient,
  phone: string,
  shopPhone: string | null
): Promise<string | null> {
  if (shopPhone && phone.trim() === shopPhone.trim()) {
    return null; // shop's own number — test notifications and replies
  }
  const customer = await findCustomerByPhone(prisma, phone);
  if (!customer) {
    return "no customer record for this phone";
  }
  if (!customer.whatsappConsent) {
    return "customer has not granted WhatsApp consent";
  }
  return null;
}

interface OutboxEntry {
  channel: string;
  createdAt: Date;
  deliverBy: Date | null;
  error: string | null;
  id: string;
  jobId: string | null;
  nextRetryAt: Date | null;
  recipientPhone: string;
  renderedBody: string;
  retryCount: number | null;
  status: OutboxStatus;
  templateName: string;
  templateParams: unknown;
}

const POLL_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;
const BACKOFF_MS = [60_000, 300_000, 900_000];
// A status notification sent a day late is worse than none — stale
// entries are cancelled instead of delivered (e.g. after the channel
// was re-enabled following days of downtime).
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;
let intervalRef: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

export async function queueNotification(
  prisma: DbClient,
  data: {
    deliverBy?: Date;
    jobId?: string;
    /** Vars de {{if}} garantidas pela config — mesmas usadas no sync Meta. */
    metaKeep?: Record<string, boolean>;
    templateName: string;
    channel: "WHATSAPP" | "SMS";
    recipientPhone: string;
    templateVars: Record<string, string>;
    templateBody: string;
  }
): Promise<void> {
  const renderedBody = renderTemplate(data.templateBody, data.templateVars);
  await createOutboxEntry(prisma, {
    channel: data.channel,
    deliverBy: data.deliverBy ?? null,
    job: data.jobId ? { connect: { id: data.jobId } } : undefined,
    recipientPhone: data.recipientPhone,
    renderedBody,
    status: OutboxStatus.QUEUED,
    templateName: data.templateName,
    // Meta exige template fora da janela de 24h — grava os params na
    // ordem dos {{var}} do corpo (a mesma ordem que o sync usa para
    // criar o template na conta da loja) E os valores por variável: se
    // o corpo for editado (reordenou {{vars}}) antes da entrega, o
    // processamento recalcula a ordem contra o corpo atual; `params`
    // fica para entradas cujo modelo foi renomeado — o remoto ainda
    // aprovado corresponde ao corpo antigo.
    templateParams:
      data.channel === "WHATSAPP"
        ? {
            params: orderedTemplateParams(
              data.templateBody,
              data.templateVars,
              data.metaKeep
            ),
            vars: data.templateVars,
          }
        : undefined,
  });
}

async function handleRetry(
  prisma: DbClient,
  entryId: string,
  currentRetries: number,
  errorMessage: string
): Promise<void> {
  if (currentRetries < MAX_RETRIES) {
    const nextRetry = new Date(
      Date.now() + BACKOFF_MS[Math.min(currentRetries, BACKOFF_MS.length - 1)]
    );
    // Guarded on QUEUED — a concurrent cancel must not be resurrected.
    await transitionOutboxEntry(prisma, entryId, OutboxStatus.QUEUED, {
      error: errorMessage,
      nextRetryAt: nextRetry,
      retryCount: currentRetries + 1,
      status: OutboxStatus.QUEUED,
    });
  } else {
    await transitionOutboxEntry(prisma, entryId, OutboxStatus.QUEUED, {
      error: errorMessage,
      nextRetryAt: null,
      status: OutboxStatus.FAILED,
    });
  }
}

async function markSent(prisma: DbClient, entryId: string): Promise<void> {
  try {
    // Guarded on QUEUED — if the entry was cancelled while the send
    // was in flight, CANCELLED wins over SENT.
    await transitionOutboxEntry(prisma, entryId, OutboxStatus.QUEUED, {
      error: null,
      sentAt: new Date(),
      status: OutboxStatus.SENT,
    });
  } catch (dbErr) {
    logger.error(
      { err: dbErr, entryId },
      "Outbox: failed to mark entry as SENT after successful send"
    );
  }
}

/**
 * Cancels an outbox entry that sat QUEUED past its useful life — a
 * status update sent days late is worse than none. Returns true when
 * the entry was cancelled (caller must skip sending).
 */
async function cancelIfExpired(
  prisma: DbClient,
  entry: OutboxEntry
): Promise<boolean> {
  // A payload with its own deadline (a signing link whose session expires
  // in minutes) dies at deliverBy — the generic 24h cutoff is far too late
  // for it, and a retry landing after expiry would send a dead link.
  if (entry.deliverBy && entry.deliverBy.getTime() <= Date.now()) {
    await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
      error: "Expired: delivery deadline passed",
      status: OutboxStatus.CANCELLED,
    });
    return true;
  }
  if (
    entry.createdAt &&
    Date.now() - entry.createdAt.getTime() > MAX_ENTRY_AGE_MS
  ) {
    await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
      error: "Expired: queued for more than 24h",
      status: OutboxStatus.CANCELLED,
    });
    return true;
  }
  return false;
}

/**
 * Cancels an outbox entry blocked by the consent gate, recording why.
 * Returns true when the entry was blocked (caller must skip sending).
 */
async function cancelIfConsentMissing(
  prisma: DbClient,
  entry: OutboxEntry,
  shopPhone: string | null
): Promise<boolean> {
  if (STAFF_INITIATED_TEMPLATES.has(entry.templateName)) {
    return false;
  }
  const consentError = await assertWhatsAppConsent(
    prisma,
    entry.recipientPhone,
    shopPhone
  );
  if (!consentError) {
    return false;
  }
  await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
    error: `Blocked: ${consentError}`,
    status: OutboxStatus.CANCELLED,
  });
  return true;
}

async function processWhatsAppEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  channel: WhatsAppChannel,
  countryCode: string,
  shopPhone: string | null,
  settings: ShopSettingsRow | null
): Promise<void> {
  if (await cancelIfExpired(prisma, entry)) {
    return;
  }
  // Consent is the law here: without it the entry is cancelled (not
  // retried) and the reason lands in the outbox error column.
  const blocked = await cancelIfConsentMissing(prisma, entry, shopPhone);
  if (blocked) {
    return;
  }
  // Meta: mensagens iniciadas pela loja saem sempre como template —
  // texto livre fora da janela de 24h é rejeitado. Evolution não tem
  // templates e SMS não passa por aqui; nesses casos o corpo renderizado
  // continua a ser o transporte.
  const storedParams = entry.templateParams as
    | string[] // formato antigo — só posicional
    | { params?: string[]; vars?: Record<string, string> }
    | null;
  let metaParams: string[] | null = Array.isArray(storedParams)
    ? storedParams
    : (storedParams?.params ?? null);
  // Reordena pelos {{var}} do corpo ATUAL do modelo quando há vars
  // gravadas — uma edição aprovada entre o enqueue e o envio muda a
  // ordem posicional na Meta; reenviar a ordem antiga trocava os
  // valores. Sem modelo local (renomeado) ficam os params gravados.
  if (
    metaParams !== null &&
    channel.mode !== "evolution" &&
    !Array.isArray(storedParams) &&
    storedParams?.vars
  ) {
    const tpl = await prisma.notificationTemplate.findFirst({
      select: { body: true },
      where: { channel: "WHATSAPP", name: entry.templateName },
    });
    if (tpl) {
      metaParams = orderedTemplateParams(
        tpl.body,
        storedParams.vars,
        metaConditionalVars(settings ?? {})
      );
    }
  }
  // Template registado como pendente/em revisão/rejeitado → adiar sem
  // gastar tentativas: enviar agora falharia na Meta e a aprovação
  // posterior não recupera mensagens já marcadas FAILED. Sem registo
  // (modelo novo de um update ainda não submetido) adia na mesma e o
  // re-sync cria-o — um template do outbox existe sempre nas
  // NotificationTemplate, por isso entra na lista desejada do sync.
  // cancelIfExpired (deliverBy) limita a espera por cima.
  if (channel.mode !== "evolution" && metaParams !== null) {
    const st = templateStatusOf(settings, entry.templateName);
    if (st !== "APPROVED") {
      await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
        error: `Template ${entry.templateName}: ${st?.toLowerCase() ?? "unsynced"}`,
        nextRetryAt: new Date(Date.now() + TEMPLATE_DEFER_MS),
        status: OutboxStatus.QUEUED,
      });
      // O estado guardado pode estar velho — a Meta aprova templates sem
      // avisar. Re-sincroniza em background (throttled) para desbloquear
      // a fila sem precisar de ação manual nas Definições.
      maybeResyncTemplates(prisma);
      return;
    }
  }
  const result =
    channel.mode !== "evolution" && metaParams !== null
      ? await sendWhatsAppTemplateVia(
          prisma,
          channel,
          entry.recipientPhone,
          entry.templateName,
          TEMPLATE_LANG,
          metaParams,
          countryCode,
          settings
        )
      : await sendWhatsAppText(
          prisma,
          channel,
          entry.recipientPhone,
          entry.renderedBody,
          countryCode,
          settings
        );
  if (result.success) {
    await markSent(prisma, entry.id);
    return;
  }
  try {
    await handleRetry(
      prisma,
      entry.id,
      entry.retryCount ?? 0,
      result.error ?? "Unknown error"
    );
  } catch (retryDbErr) {
    logger.error(
      { err: retryDbErr, entryId: entry.id },
      "Outbox: failed to update retry state after failed send"
    );
  }
}

async function processSmsEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  channels: SmsChannels,
  countryCode: string,
  shopPhone: string | null
): Promise<void> {
  if (await cancelIfExpired(prisma, entry)) {
    return;
  }
  const blocked = await cancelIfConsentMissing(prisma, entry, shopPhone);
  if (blocked) {
    return;
  }
  // Pro: envia pela Cloud (device da loja ou pool) — o id do outbox é o
  // dedupeId para a Cloud não repetir um envio já aceite. O gateway LAN
  // (se configurado) é fallback SÓ em erro definitivo (sem device, sem
  // entitlement): erro de rede/5xx pode significar envio aceite cuja
  // confirmação se perdeu — cair para LAN duplicava o SMS, porque o
  // dedupeId só protege o caminho Cloud. Relatórios de entrega voltam
  // como REPORT na fila inbound.
  let result: SendResult | null = null;
  if (channels.cloud) {
    const jobCode = entry.jobId
      ? (
          await prisma.job.findUnique({
            select: { jobCode: true },
            where: { id: entry.jobId },
          })
        )?.jobCode
      : undefined;
    result = await sendSmsViaCloud(channels.cloud, {
      dedupeId: entry.id,
      jobCode,
      text: entry.renderedBody,
      to: formatPhone(entry.recipientPhone, countryCode),
    }).catch((err) => ({
      error: err instanceof Error ? err.message : "CLOUD_UNREACHABLE",
      success: false,
    }));
  }
  if (
    !result?.success &&
    channels.local &&
    (result === null || isDefinitiveCloudError(result.error))
  ) {
    result = await sendSms(
      channels.local,
      entry.recipientPhone,
      entry.renderedBody,
      countryCode
    );
  }
  result ??= { error: "SMS channel unavailable", success: false };
  if (result.success) {
    await markSent(prisma, entry.id);
    return;
  }
  try {
    await handleRetry(
      prisma,
      entry.id,
      entry.retryCount ?? 0,
      result.error ?? "Unknown error"
    );
  } catch (retryDbErr) {
    logger.error(
      { err: retryDbErr, entryId: entry.id },
      "Outbox: failed to update retry state after failed send"
    );
  }
}

interface SmsChannels {
  /** Credenciais cloud — só preenchidas com o entitlement "sms" ativo. */
  cloud: CloudCredentials | null;
  local: { password: string; url: string; user: string } | null;
}

interface ChannelConfigs {
  sms: SmsChannels | null;
  whatsapp: WhatsAppChannel | null;
}

async function processEntry(
  prisma: DbClient,
  entry: OutboxEntry,
  configs: ChannelConfigs,
  countryCode: string,
  shopPhone: string | null,
  shopSettings: ShopSettingsRow | null
): Promise<void> {
  try {
    if (entry.channel === "WHATSAPP" && configs.whatsapp) {
      await processWhatsAppEntry(
        prisma,
        entry,
        configs.whatsapp,
        countryCode,
        shopPhone,
        shopSettings
      );
    } else if (entry.channel === "SMS" && configs.sms) {
      await processSmsEntry(prisma, entry, configs.sms, countryCode, shopPhone);
    } else if (entry.channel === "WHATSAPP" || entry.channel === "SMS") {
      // Channel not configured — cancel now. Leaving it QUEUED would
      // re-select it on every 5s poll and starve the batch of 10.
      await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
        error: `Channel ${entry.channel} is not configured`,
        status: OutboxStatus.CANCELLED,
      });
      return;
    } else {
      logger.warn(
        `Outbox: unexpected channel "${entry.channel}" for entry ${entry.id} — marking FAILED`
      );
      try {
        await transitionOutboxEntry(prisma, entry.id, OutboxStatus.QUEUED, {
          error: `Unsupported channel: ${entry.channel}`,
          status: OutboxStatus.FAILED,
        });
      } catch (dbErr) {
        logger.error(
          { err: dbErr, entryId: entry.id },
          "Outbox: failed to mark unsupported channel entry as FAILED"
        );
      }
    }
  } catch (err) {
    logger.warn({ err, entryId: entry.id }, "Outbox: failed to process entry");
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await handleRetry(prisma, entry.id, entry.retryCount ?? 0, msg);
    } catch (retryErr) {
      logger.error(
        { err: retryErr, entryId: entry.id },
        "Outbox: failed to handle retry"
      );
    }
  }
}

export async function processOutbox(prisma: DbClient): Promise<void> {
  if (isProcessing) {
    return;
  }
  isProcessing = true;
  try {
    const pending = await findManyOutboxEntries(
      prisma,
      {
        status: OutboxStatus.QUEUED,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      { createdAt: "asc" },
      10
    );

    if (pending.length === 0) {
      return;
    }

    const shopSettings = await findShopSettingsUnique(prisma);
    const configs: ChannelConfigs = {
      sms: getSmsConfig(shopSettings),
      whatsapp: shopSettings ? resolveWhatsAppChannel(shopSettings) : null,
    };
    if (!(configs.whatsapp || configs.sms)) {
      return;
    }
    const countryCode = shopSettings?.countryCode ?? "PT";

    for (const entry of pending) {
      await processEntry(
        prisma,
        entry,
        configs,
        countryCode,
        shopSettings?.phone ?? null,
        shopSettings
      );
    }
  } finally {
    isProcessing = false;
  }
}

export function startOutboxWorker(prisma: DbClient): () => void {
  intervalRef = setInterval(() => {
    processOutbox(prisma).catch((err) => {
      logger.error("Outbox worker error:", err);
    });
  }, POLL_INTERVAL_MS);
  if (intervalRef.unref) {
    intervalRef.unref();
  }
  return () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = null;
    }
  };
}

type ShopSettingsRow = NonNullable<
  Awaited<ReturnType<typeof findShopSettingsUnique>>
>;

function getSmsConfig(row: ShopSettingsRow | null): SmsChannels | null {
  // Grátis = gateway LAN; Pro (entitlement "sms") = envio pela Cloud
  // com fallback para o LAN quando este também está configurado.
  const modules = Array.isArray(row?.cloudEntitlements)
    ? (row?.cloudEntitlements as string[])
    : [];
  const cloud =
    modules.includes("sms") && row?.cloudApiUrl && row?.cloudShopTokenEncrypted
      ? {
          apiUrl: row.cloudApiUrl,
          token: decryptSecret(row.cloudShopTokenEncrypted),
        }
      : null;
  const local = row?.smsEnabled
    ? decryptSmsConfig({
        gatewayPasswordEncrypted: row.smsGatewayPasswordEncrypted,
        gatewayUrl: row.smsGatewayUrl,
        gatewayUser: row.smsGatewayUser,
      })
    : null;
  if (!(cloud || local)) {
    return null;
  }
  return { cloud, local };
}

export async function getOutboxLogs(
  prisma: DbClient,
  limit = 50
): Promise<OutboxEntry[]> {
  const entries = await findManyOutboxEntries(
    prisma,
    {},
    { createdAt: "desc" },
    limit
  );
  return entries.map((e) => ({
    channel: e.channel,
    createdAt: e.createdAt,
    deliverBy: e.deliverBy,
    error: e.error,
    id: e.id,
    jobId: e.jobId,
    nextRetryAt: e.nextRetryAt,
    renderedBody: e.renderedBody,
    recipientPhone: e.recipientPhone,
    retryCount: e.retryCount,
    status: e.status,
    templateName: e.templateName,
    templateParams: e.templateParams,
  }));
}

export async function cancelOutboxEntry(prisma: DbClient, id: string) {
  const entry = await findOutboxEntryById(prisma, id);
  if (!entry) {
    throw new AppError("NOT_FOUND");
  }
  if (entry.status !== OutboxStatus.QUEUED) {
    throw new AppError("OUTBOX_NOT_QUEUED");
  }
  // Conditional transition — a worker may flip the entry between the
  // read above and this write; only cancel while still QUEUED.
  const count = await transitionOutboxEntry(prisma, id, OutboxStatus.QUEUED, {
    status: OutboxStatus.CANCELLED,
  });
  if (count === 0) {
    throw new AppError("OUTBOX_NOT_QUEUED");
  }
  return { id, status: OutboxStatus.CANCELLED };
}

export async function testNotification(prisma: DbClient, templateId: string) {
  const template = await findNotificationTemplateUnique(prisma, templateId);
  if (!template) {
    throw new AppError("TEMPLATE_NOT_FOUND");
  }
  if (template.channel !== "WHATSAPP" && template.channel !== "SMS") {
    throw new AppError("TEMPLATE_NOT_FOUND");
  }
  const shop = await findShopSettingsUnique(prisma);
  const phone = shop?.phone;
  if (!phone) {
    throw new AppError("NO_SHOP_PHONE");
  }
  const templateVars: Record<string, string> = {
    customerName: "Test",
    jobCode: "TEST-001",
    shopName: shop?.shopName ?? "OficinaOS",
  };
  // O modelo aprovado na Meta inclui os links {{if}} configurados — um
  // parâmetro vazio é rejeitado, por isso cada var do corpo precisa de
  // um valor (reais os links configurados, placeholder o resto).
  if (shop?.trackingBaseUrl) {
    templateVars.trackingUrl = `${shop.trackingBaseUrl.replace(
      TRAILING_SLASHES_RE,
      ""
    )}/tracking/TEST-001`;
  }
  if (shop?.reviewUrl) {
    templateVars.reviewUrl = shop.reviewUrl;
  }
  for (const m of template.body.matchAll(TEMPLATE_VAR_RE)) {
    const name = m[1];
    if (name === "if" || name === "else" || name === "endif") {
      continue;
    }
    templateVars[name] ??= URLISH_VAR_RE.test(name)
      ? "https://oficinaos.app"
      : "demo";
  }
  await queueNotification(prisma, {
    channel: template.channel,
    metaKeep: metaConditionalVars(shop ?? {}),
    recipientPhone: phone,
    templateBody: template.body,
    templateName: template.name,
    templateVars,
  });
}
