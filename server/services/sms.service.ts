import { randomBytes } from "node:crypto";
import { OutboxStatus, type PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import { transitionOutboxEntry } from "../repositories/notification.repository.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import {
  type BotReplyCtx,
  composeReply,
  escalateToStaff,
  rateOk,
} from "./bot-intents.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { formatPhone } from "./notification-sender.js";
import {
  type CustomSmsConfig,
  resolveCustomSmsConfig,
  sendCustomSms,
} from "./sms-custom.service.js";

/**
 * Canal SMS multi-transporte:
 * - "android" (free) — SMS Gateway for Android em modo Local Server na
 *   LAN da loja: envio HTTP direto + inbound por webhook no aparelho.
 * - "custom" (free) — API HTTP arbitrária descrita pela loja (URL +
 *   headers + body template), outbound only.
 * - "cloud" (Pro module "sms") — credenciais BulkSMS da loja guardadas
 *   na cloud, envio por POST /sms/send com entitlement enforçado
 *   server-side; replies/reports entram por webhook na cloud e a app
 *   recolhe por poll. Uma app adulterada não contorna — o envio só
 *   existe lá fora.
 */

const TRAILING_SLASH_RE = /\/+$/;
const WEBHOOK_ID = "oficinaos-inbound";

export interface SmsConfig {
  password: string;
  url: string;
  user: string;
}

export type SmsChannel =
  | { config: SmsConfig; mode: "android" }
  | { config: CustomSmsConfig; mode: "custom" }
  | { apiUrl: string; mode: "cloud"; shopToken: string };

interface SmsSettingsLike {
  cloudApiUrl?: string | null;
  cloudShopTokenEncrypted?: string | null;
  smsCredentialsAtCloud?: boolean | null;
  smsCustomBodyFormat?: string | null;
  smsCustomBodyTemplate?: string | null;
  smsCustomHeadersEncrypted?: string | null;
  smsCustomMethod?: string | null;
  smsCustomSuccessText?: string | null;
  smsCustomUrl?: string | null;
  smsEnabled?: boolean | null;
  smsGatewayPasswordEncrypted?: string | null;
  smsGatewayUrl?: string | null;
  smsGatewayUser?: string | null;
  smsTransport?: string | null;
}

interface SendResult {
  error?: string;
  success: boolean;
}

function authHeader(config: SmsConfig): string {
  return `Basic ${Buffer.from(`${config.user}:${config.password}`).toString(
    "base64"
  )}`;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(TRAILING_SLASH_RE, "");
}

export function decryptSmsConfig(encrypted: {
  gatewayPasswordEncrypted: string | null;
  gatewayUrl: string | null;
  gatewayUser: string | null;
}): SmsConfig | null {
  if (
    !(
      encrypted.gatewayUrl &&
      encrypted.gatewayUser &&
      encrypted.gatewayPasswordEncrypted
    )
  ) {
    return null;
  }
  const password = isEncrypted(encrypted.gatewayPasswordEncrypted)
    ? decryptSecret(encrypted.gatewayPasswordEncrypted)
    : encrypted.gatewayPasswordEncrypted;
  if (!password) {
    return null;
  }
  return {
    password,
    url: normalizeUrl(encrypted.gatewayUrl),
    user: encrypted.gatewayUser,
  };
}

export async function sendSms(
  config: SmsConfig,
  to: string,
  text: string,
  countryCode?: string
): Promise<SendResult> {
  assertNotDemoMode();
  const url = `${config.url}/message`;
  const payload = {
    phoneNumbers: [formatPhone(to, countryCode)],
    textMessage: { text },
  };

  try {
    const response = await fetch(url, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: authHeader(config),
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return { success: true };
    }
    const body = await response.text();
    return {
      success: false,
      error: `SMS gateway ${response.status}: ${body.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Liveness probe do gateway — GET /health existe no modo Local Server. */
export async function checkSmsGateway(config: SmsConfig): Promise<SendResult> {
  assertNotDemoMode();
  try {
    const response = await fetch(`${config.url}/health`, {
      headers: { Authorization: authHeader(config) },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      return { success: true };
    }
    return { success: false, error: `Gateway respondeu ${response.status}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gateway inalcançável",
    };
  }
}

/**
 * Regista o webhook sms:received no telemóvel para o callbackUrl indicado.
 * Remove primeiro um registo "oficinaos-inbound" anterior — o registo é
 * idempotente e sobrevive a re-saves das settings.
 */
export async function registerSmsWebhook(
  config: SmsConfig,
  callbackUrl: string
): Promise<SendResult> {
  assertNotDemoMode();
  try {
    const listRes = await fetch(`${config.url}/webhooks`, {
      headers: { Authorization: authHeader(config) },
      signal: AbortSignal.timeout(10_000),
    });
    if (listRes.ok) {
      const hooks = (await listRes.json()) as { id: string }[];
      for (const hook of Array.isArray(hooks) ? hooks : []) {
        if (hook.id === WEBHOOK_ID) {
          await fetch(`${config.url}/webhooks/${hook.id}`, {
            headers: { Authorization: authHeader(config) },
            method: "DELETE",
            signal: AbortSignal.timeout(10_000),
          }).catch(() => null);
        }
      }
    }

    const response = await fetch(`${config.url}/webhooks`, {
      body: JSON.stringify({
        event: "sms:received",
        id: WEBHOOK_ID,
        url: callbackUrl,
      }),
      headers: {
        Authorization: authHeader(config),
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      return { success: true };
    }
    const body = await response.text();
    return {
      success: false,
      error: `SMS gateway ${response.status}: ${body.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export function generateSmsWebhookToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Resolve o transporte ativo — android (gateway LAN), custom (API HTTP
 * da loja) ou cloud (BulkSMS via relay). O canal "custom" resolve no
 * seu próprio ficheiro; "cloud" só resolve quando a cloud já aceitou
 * as credenciais (pendências continuam no android/sem envio até lá).
 */
export function resolveSmsChannel(
  settings: SmsSettingsLike | null
): SmsChannel | null {
  if (!settings?.smsEnabled) {
    return null;
  }
  const transport = settings.smsTransport;
  if (transport === "custom") {
    const config = resolveCustomSmsConfig(settings);
    return config ? { config, mode: "custom" } : null;
  }
  if (transport === "cloud") {
    if (
      !(
        settings.smsCredentialsAtCloud &&
        settings.cloudApiUrl &&
        settings.cloudShopTokenEncrypted
      )
    ) {
      return null;
    }
    const shopToken = decryptSecret(settings.cloudShopTokenEncrypted);
    return shopToken
      ? { apiUrl: settings.cloudApiUrl, mode: "cloud", shopToken }
      : null;
  }
  const config = decryptSmsConfig({
    gatewayPasswordEncrypted: settings.smsGatewayPasswordEncrypted ?? null,
    gatewayUrl: settings.smsGatewayUrl ?? null,
    gatewayUser: settings.smsGatewayUser ?? null,
  });
  return config ? { config, mode: "android" } : null;
}

function cloudSmsError(status: number, body: unknown): string {
  const msg = (body as { error?: { message?: string } } | null)?.error?.message;
  if (status === 402) {
    return "SMS module not active in the subscription";
  }
  if (status === 409) {
    return "SMS credentials missing in cloud — rerun setup";
  }
  return msg ?? `Cloud returned ${status}`;
}

async function sendViaSmsCloud(
  apiUrl: string,
  shopToken: string,
  to: string,
  text: string,
  dedupeId?: string
): Promise<SendResult> {
  const res = await cloudFetch(apiUrl, "/sms/send", {
    body: { dedupeId, text, to },
    method: "POST",
    timeoutMs: 20_000,
    token: shopToken,
  }).catch(() => null);
  if (!res) {
    return { error: "awaiting cloud connection", success: false };
  }
  if (!res.ok) {
    return { error: cloudSmsError(res.status, res.body), success: false };
  }
  return { success: true };
}

/**
 * Envia pelo canal resolvido — android/custom direto, cloud via relay.
 * dedupeId vai para a cloud mapear no deduplication-id do provider:
 * retries da outbox não duplicam envios na conta da loja.
 */
export function sendSmsMessage(
  channel: SmsChannel,
  to: string,
  text: string,
  countryCode?: string,
  dedupeId?: string
): Promise<SendResult> {
  assertNotDemoMode();
  if (channel.mode === "android") {
    return sendSms(channel.config, to, text, countryCode);
  }
  if (channel.mode === "custom") {
    return sendCustomSms(channel.config, to, text, countryCode);
  }
  return sendViaSmsCloud(
    channel.apiUrl,
    channel.shopToken,
    formatPhone(to, countryCode),
    text,
    dedupeId
  );
}

/**
 * Empurra as credenciais BulkSMS da loja para a cloud (POST
 * /shops/sms-credentials). Corre no save das settings e no poll —
 * depois de aceite, o secret local é apagado (mesma lógica do token
 * Meta) e smsCredentialsAtCloud passa a true.
 */
export async function pushSmsCredentialsToCloud(
  prisma: DbClient
): Promise<boolean> {
  const settings = await getOrCreateShopSettings(prisma);
  if (
    !(
      settings.cloudApiUrl &&
      settings.cloudShopTokenEncrypted &&
      settings.smsBulksmsTokenId &&
      settings.smsBulksmsSecretEncrypted
    )
  ) {
    return Boolean(settings.smsCredentialsAtCloud);
  }
  if (settings.smsCredentialsAtCloud) {
    return true;
  }
  const shopToken = decryptSecret(settings.cloudShopTokenEncrypted);
  const rawSecret = settings.smsBulksmsSecretEncrypted;
  const tokenSecret = isEncrypted(rawSecret)
    ? decryptSecret(rawSecret)
    : rawSecret;
  if (!(shopToken && tokenSecret)) {
    return false;
  }
  const webhookSecret =
    settings.smsCloudWebhookSecret ?? generateSmsWebhookToken();
  const res = await cloudFetch(settings.cloudApiUrl, "/shops/sms-credentials", {
    body: {
      senderId: settings.smsCloudSender ?? undefined,
      tokenId: settings.smsBulksmsTokenId,
      tokenSecret,
      webhookSecret,
    },
    method: "POST",
    token: shopToken,
  }).catch(() => null);
  if (!res?.ok) {
    return false;
  }
  // A cloud devolve o URL público completo (PUBLIC_BASE_URL dela — a app
  // não o consegue deduzir localmente) para a loja registar RECEIVED+SENT
  // na Web App do BulkSMS.
  const returnedUrl = (res.body as { webhookUrl?: string | null } | null)
    ?.webhookUrl;
  await prisma.shopSettings.update({
    data: {
      smsBulksmsSecretEncrypted: null,
      smsCloudWebhookSecret: webhookSecret,
      smsCloudWebhookUrl: returnedUrl ?? null,
      smsCredentialsAtCloud: true,
    },
    where: { id: "default" },
  });
  return true;
}

/**
 * Processa um SMS recebido: compõe a resposta via intents partilhados
 * (estado da reparação, orçamento SIM/NÃO) e responde pelo transporte
 * ativo. plainText=true — SMS não renderiza os marcadores *bold* do
 * WhatsApp.
 */
export async function handleInboundSms(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  fromPhone: string,
  text: string
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  const channel = resolveSmsChannel(settings);
  if (!(channel && rateOk(fromPhone))) {
    return;
  }

  const ctx: BotReplyCtx = {
    currency: settings.currency ?? "EUR",
    log,
    notifyCtx,
    prisma,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
  };
  const msg = {
    createdAt: new Date().toISOString(),
    fromPhone,
    id: `sms-${Date.now()}`,
    messageType: "text",
    text,
  };

  try {
    const out = await composeReply(ctx, msg, true);
    const res = await sendSmsMessage(
      channel,
      fromPhone,
      out.text,
      settings.countryCode ?? undefined
    );
    if (!res.success) {
      log.warn({ err: res.error, to: fromPhone }, "sms-bot reply failed");
    }
    if (out.escalate) {
      await escalateToStaff(ctx, "SMS", msg, out.customerName, out.jobId).catch(
        (err) => log.warn({ err }, "sms-bot escalate failed")
      );
    }
  } catch (err) {
    log.warn({ err, fromPhone }, "sms-bot inbound failed");
  }
}

interface CloudSmsInbound {
  createdAt?: string;
  fromPhone: string;
  id: string;
  kind?: string; // RECEIVED | REPORT (delivery status — não passa no bot)
  messageType?: string;
  refId?: string | null;
  statusType?: string | null;
  text?: string | null;
}

/**
 * Poll do transporte "cloud" (Pro module "sms"): garante que as
 * credenciais BulkSMS migraram, recolhe replies enfileiradas pelo
 * webhook da cloud e responde pelo relay. Espelho do syncWhatsAppBot.
 */
export async function syncSmsCloud(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  await pushSmsCredentialsToCloud(prisma);
  const channel = resolveSmsChannel(await getOrCreateShopSettings(prisma));
  if (!channel) {
    return; // módulo ativo mas SMS por configurar — fila fica a aguardar
  }

  const res = await cloudFetch(apiUrl, "/sms/inbound", { token });
  if (!res.ok) {
    return;
  }
  const messages =
    (res.body as { messages?: CloudSmsInbound[] }).messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const ctx: BotReplyCtx = {
    currency: settings.currency ?? "EUR",
    log,
    notifyCtx,
    prisma,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
  };
  const countryCode = settings.countryCode ?? undefined;
  const ackIds: string[] = [];
  for (const msg of messages) {
    const ack = await processCloudInbound(ctx, channel, msg, countryCode, log);
    if (ack) {
      ackIds.push(msg.id);
    }
  }
  if (ackIds.length) {
    await cloudFetch(apiUrl, "/sms/inbound/ack", {
      body: { ids: ackIds },
      method: "POST",
      token,
    });
  }
}

// Estados terminais de falha do BulkSMS (status.type num status-report):
// tudo o que não é terminal (ACCEPTED, ENROUTE, SENT…) deixa a entry em
// SENT — um report intermédio nunca regride uma entrega já confirmada.
const REPORT_FAILED_TYPES = new Set([
  "DELETED",
  "EXPIRED",
  "FAILED",
  "REJECTED",
  "UNDELIVERABLE",
]);

/**
 * Aplica um delivery report à outbox entry que originou o envio.
 * SENT → DELIVERED | FAILED, só nessa direção: reports fora de ordem ou
 * duplicados (a rede móvel repete-os) nunca reescrevem um estado final.
 */
async function applyDeliveryReport(
  prisma: DbClient,
  refId: string | null | undefined,
  statusType: string | null | undefined,
  log: FastifyBaseLogger
): Promise<boolean> {
  if (!(refId && statusType)) {
    return true; // report sem ligação possível — nada a fazer, ack segue
  }
  let next: { error?: string; status: OutboxStatus };
  if (statusType === "DELIVERED") {
    next = { status: OutboxStatus.DELIVERED };
  } else if (REPORT_FAILED_TYPES.has(statusType)) {
    next = {
      error: `delivery failed — ${statusType}`,
      status: OutboxStatus.FAILED,
    };
  } else {
    return true; // estado intermédio — nada a gravar
  }
  // A transition failure or zero affected rows (entry still QUEUED —
  // the report arrived before the send ack) means the status was never
  // persisted: return false so the report stays queued for the next
  // poll instead of being acked with a wrong outbox status.
  try {
    const updated = await transitionOutboxEntry(
      prisma,
      refId,
      OutboxStatus.SENT,
      next
    );
    if (updated > 0) {
      return true;
    }
  } catch (err) {
    log.warn({ err, refId }, "sms report transition failed");
    return false;
  }
  // Zero rows updated on a terminal report: either the entry is still
  // QUEUED (the report raced ahead of the send ack — keep it queued for
  // the next poll) or the transition already persisted and the ack was
  // lost / the report is a duplicate / the entry was deleted — in every
  // one of those cases it is safe to ack, otherwise the report would sit
  // in the cloud queue forever.
  const entry: { status: OutboxStatus } | null | "lookup-failed" =
    await prisma.notificationOutbox
      .findUnique({
        select: { status: true },
        where: { id: refId },
      })
      .catch((err: unknown) => {
        log.warn({ err, refId }, "sms report status lookup failed");
        return "lookup-failed";
      });
  if (entry === "lookup-failed") {
    return false; // lookup falhou — retry no próximo poll
  }
  if (entry == null) {
    return true; // entry apagada — ack seguro
  }
  return (
    entry.status !== OutboxStatus.QUEUED && entry.status !== OutboxStatus.SENT
  );
}

/**
 * Uma reply da fila: rate-limit → bot-intents → resposta via relay →
 * escalate staff se necessário. Devolve true quando é seguro dar ack
 * (enviada ou poisoned — falha transitória fica para o próximo poll).
 */
async function processCloudInbound(
  ctx: BotReplyCtx,
  channel: SmsChannel,
  msg: CloudSmsInbound,
  countryCode: string | undefined,
  log: FastifyBaseLogger
): Promise<boolean> {
  try {
    // Delivery reports não são texto do bot nem consomem a quota de
    // replies do cliente — tratam-se antes do rate limit.
    if (msg.kind === "REPORT") {
      return await applyDeliveryReport(
        ctx.prisma,
        msg.refId,
        msg.statusType,
        log
      );
    }
    if (!rateOk(msg.fromPhone)) {
      return true;
    }
    const inbound = {
      createdAt: msg.createdAt ?? new Date().toISOString(),
      fromPhone: msg.fromPhone,
      id: msg.id,
      messageType: msg.messageType ?? "text",
      text: msg.text ?? "",
    };
    const out = await composeReply(ctx, inbound, true);
    const sent = await sendSmsMessage(
      channel,
      msg.fromPhone,
      out.text,
      countryCode
    );
    // Staff escalate first: a failed outbound reply must not swallow
    // the customer's request for help (retries re-escalate — harmless).
    if (out.escalate) {
      await escalateToStaff(
        ctx,
        "SMS",
        inbound,
        out.customerName,
        out.jobId
      ).catch((err) => log.warn({ err }, "sms-cloud escalate failed"));
    }
    if (!sent.success) {
      log.warn(
        { err: sent.error, to: msg.fromPhone },
        "sms-cloud reply failed"
      );
      return false; // retry no próximo poll — sem ack
    }
    return true;
  } catch (err) {
    log.warn({ err, msgId: msg.id }, "sms-cloud inbound failed");
    return true; // poisoned — não fica em loop
  }
}
