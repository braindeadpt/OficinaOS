import { OutboxStatus, type PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import {
  type BotReplyCtx,
  handleInboundMessage,
  type InboundMessage,
} from "./bot-intents.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { maskPhone } from "./whatsapp-channel.js";

/**
 * SMS Pro (módulo "sms"): o telemóvel gateway liga-se à Cloud (servidor
 * público sms-gate ou, no futuro, o nosso — o base URL é por device).
 * A Cloud encaminha inbound por loja via SmsRoute e fila-o em
 * SmsInbound; a app faz poll, responde pelo pipeline partilhado e
 * confirma com ack. Envio: POST /sms/send com o id do outbox como
 * dedupeId — relatórios sms:sent/delivered/failed voltam como REPORT.
 *
 * Grátis = só envio (gateway LAN): inbound não é processado — nem
 * aqui nem na rota pública /sms/inbound/:token.
 */

const MAX_SEND_ATTEMPTS = 3;
const REPORT_STATUS_RE = /^(SENT|DELIVERED|FAILED|CANCELLED)$/;
const LEADING_PLUS_RE = /^\+/;

// In-memory send-attempt counter — same trade-off as whatsapp-bot.
const sendAttempts = new Map<string, number>();

interface CloudSmsItem {
  createdAt: string;
  fromPhone: string;
  id: string;
  refId?: string | null;
  status?: string | null;
  text?: string | null;
  type: "RECEIVED" | "REPORT";
}

export interface CloudCredentials {
  apiUrl: string;
  token: string;
}

/**
 * Envio SMS via Cloud — Pro com device atribuído. Devolve o mesmo
 * contrato que sendSms (gateway LAN) para o outbox escolher o
 * transporte sem saber qual é.
 */
export async function sendSmsViaCloud(
  creds: CloudCredentials,
  input: { dedupeId: string; jobCode?: string; text: string; to: string }
): Promise<{ error?: string; success: boolean }> {
  const res = await cloudFetch(creds.apiUrl, "/sms/send", {
    body: {
      dedupeId: input.dedupeId,
      jobCode: input.jobCode,
      text: input.text,
      to: input.to,
    },
    method: "POST",
    token: creds.token,
  });
  if (!res.ok) {
    const code =
      typeof res.body === "object" && res.body !== null
        ? (res.body as { code?: string }).code
        : undefined;
    return { error: code ?? `HTTP_${res.status}`, success: false };
  }
  return { success: true };
}

/** true quando o erro da Cloud indica "sem device" → cair p/ gateway LAN. */
export function isNoDeviceError(error?: string): boolean {
  return error === "NO_SMS_DEVICE";
}

/**
 * Poll da fila SMS Pro + processamento. Chamado pelo poller rápido
 * (10–15 s) quando o entitlement "sms" está ativo.
 */
export async function syncSmsInbound(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  modules: string[] = []
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/sms/inbound", { token });
  if (!res.ok) {
    return;
  }
  const items = (res.body as { items?: CloudSmsItem[] }).items ?? [];
  if (items.length === 0) {
    return;
  }

  const settings = await getOrCreateShopSettings(prisma);
  const ctx: BotReplyCtx = {
    ai: {
      apiUrl,
      avgRepairDaysAfterPart: settings.botAvgRepairDaysAfterPart,
      botInfoText: settings.botInfoText,
      channel: "sms",
      enabled: settings.botAiEnabled,
      module: "sms",
      modules,
      token,
    },
    currency: settings.currency ?? "EUR",
    log,
    notifyCtx,
    portalApiUrl: apiUrl,
    portalEnabled: modules.includes("portal"),
    prisma,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
  };

  const ackIds: string[] = [];
  for (const item of items) {
    if (item.type === "REPORT") {
      if (await applyReport(prisma, log, item)) {
        ackIds.push(item.id);
      }
      continue;
    }
    if (await processReceived(ctx, { apiUrl, token }, item)) {
      ackIds.push(item.id);
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

/** RECEIVED → pipeline do bot; resposta sai pela Cloud (/sms/send). */
async function processReceived(
  ctx: BotReplyCtx,
  c: CloudCredentials,
  item: CloudSmsItem
): Promise<boolean> {
  try {
    const msg: InboundMessage = {
      createdAt: item.createdAt,
      fromPhone: item.fromPhone,
      id: item.id,
      messageType: "text",
      text: item.text ?? null,
    };
    const out = await handleInboundMessage(ctx, msg, {
      channelLabel: "SMS",
      plainText: true,
      send: async (text) => {
        const r = await sendSmsViaCloud(c, {
          dedupeId: `bot-${item.id}`,
          text,
          to: `+${item.fromPhone.replace(LEADING_PLUS_RE, "")}`,
        });
        if (!r.success) {
          ctx.log.warn(
            { err: r.error, to: maskPhone(item.fromPhone) },
            "sms-cloud reply failed"
          );
        }
        return r.success;
      },
    });
    if (!out) {
      return true; // flood — descarta sem responder
    }
    if (out.sent) {
      return true;
    }
    const attempts = (sendAttempts.get(item.id) ?? 0) + 1;
    sendAttempts.set(item.id, attempts);
    if (attempts >= MAX_SEND_ATTEMPTS) {
      ctx.log.error({ msgId: item.id }, "sms-cloud giving up on message");
      return true;
    }
    return false;
  } catch (err) {
    ctx.log.warn({ err, msgId: item.id }, "sms-cloud message failed");
    return true; // poisoned — don't loop forever
  }
}

/** REPORT → estado de entrega do outbox (dedupeId = outbox entry id). */
async function applyReport(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  item: CloudSmsItem
): Promise<boolean> {
  const status = (item.status ?? "").toUpperCase();
  if (!(item.refId && REPORT_STATUS_RE.test(status))) {
    return true; // malformed — ack e seguir
  }
  try {
    const entry = await prisma.notificationOutbox.findUnique({
      where: { id: item.refId },
    });
    if (!entry) {
      return true; // relatório de envio que não é nosso (ex.: resposta do bot)
    }
    if (status === "DELIVERED" || status === "SENT") {
      if (entry.status !== OutboxStatus.SENT) {
        await prisma.notificationOutbox.update({
          data: { sentAt: new Date(), status: OutboxStatus.SENT },
          where: { id: entry.id },
        });
      }
      return true;
    }
    await prisma.notificationOutbox.update({
      data: {
        error: `SMS Gateway: ${status.toLowerCase()}`,
        status:
          status === "CANCELLED" ? OutboxStatus.CANCELLED : OutboxStatus.FAILED,
      },
      where: { id: entry.id },
    });
    return true;
  } catch (err) {
    log.warn({ err, refId: item.refId }, "sms-cloud report update failed");
    return false; // retry no próximo poll
  }
}

export interface SmsDeviceStatus {
  configured: boolean;
  device: null | {
    enabled: boolean;
    gatewayDeviceId: string;
    label: string;
    lastSeenAt: string | null;
    offline: boolean;
    phoneE164: string | null;
    webhookUrl: string;
  };
  entitled: boolean;
  reachable: boolean;
}

/** Estado do device SMS Pro para as Definições — proxy de GET /shops/sms-device. */
export async function getSmsDeviceStatus(
  prisma: PrismaClient
): Promise<SmsDeviceStatus> {
  const settings = await getOrCreateShopSettings(prisma);
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[])
    : [];
  const base: SmsDeviceStatus = {
    configured: false,
    device: null,
    entitled: modules.includes("sms"),
    reachable: false,
  };
  if (
    !(base.entitled && settings.cloudApiUrl && settings.cloudShopTokenEncrypted)
  ) {
    return base;
  }
  const res = await cloudFetch(settings.cloudApiUrl, "/shops/sms-device", {
    token: decryptSecret(settings.cloudShopTokenEncrypted),
  }).catch(() => null);
  if (!res?.ok || typeof res.body !== "object" || res.body === null) {
    return base;
  }
  const body = res.body as {
    configured?: boolean;
    device?: SmsDeviceStatus["device"];
  };
  return {
    configured: Boolean(body.configured),
    device: body.device ?? null,
    entitled: true,
    reachable: true,
  };
}
