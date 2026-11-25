import { OutboxStatus, type PrismaClient } from "@generated/client";
import { toSmsText } from "@shared/utils/gsm7.js";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { isModuleEnabled } from "../utils/modules.js";
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
 * Grátis = não envia nada (decisão 2026-11-23): inbound não é
 * processado — nem aqui nem na rota pública /sms/inbound/:token.
 */

const MAX_SEND_ATTEMPTS = 3;
const REPORT_STATUS_RE = /^(SENT|DELIVERED|FAILED|CANCELLED)$/;
const LEADING_PLUS_RE = /^\+/;

// In-memory send-attempt counter — same trade-off as whatsapp-bot.
const sendAttempts = new Map<string, number>();

// Ids em processamento — o poller rápido (12 s) e o ciclo lento (2 min)
// leem a mesma fila antes do ack; sem esta guarda ambos processavam a
// mesma mensagem e duplicavam respostas e alertas ao staff.
const inFlightIds = new Set<string>();

// Contrato do GET /sms/inbound na Cloud: `messages` com `kind` +
// `statusType` (modelo SmsInbound) — não `items`/`type`/`status`.
interface CloudSmsItem {
  createdAt: string;
  fromPhone: string;
  id: string;
  kind: "RECEIVED" | "REPORT";
  refId?: string | null;
  statusType?: string | null;
  text?: string | null;
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

// Erros definitivos da Cloud — não se resolvem com retry e o envio
// nunca foi aceite: seguro cair para o gateway LAN. Erros de rede/5xx/
// provider são ambíguos (a Cloud pode ter aceite e a confirmação
// perdeu-se) → não cair, o dedupeId protege o retry pela Cloud.
const DEFINITIVE_CLOUD_ERRORS = new Set([
  "DEVICE_MISSING",
  "INVALID_BODY",
  "MODULE_NOT_ENTITLED",
  "SHOP_NOT_FOUND",
  "UNAUTHORIZED",
]);

/** true quando o erro da Cloud é definitivo → cair p/ gateway LAN. */
export function isDefinitiveCloudError(error?: string): boolean {
  return error !== undefined && DEFINITIVE_CLOUD_ERRORS.has(error);
}

// Um ciclo de cada vez: o poller rápido (10 s) e a sync lenta (2 min)
// chamam os dois esta função e GET→process→ACK não é atómico. Sem o
// dono único o segundo ciclo lia a fila antes do primeiro chegar ao
// claim in-flight e ambos processavam/respondiam a mesma mensagem.
let smsCycleRunning = false;

/**
 * Poll da fila SMS Pro + processamento. Chamado pelo poller rápido
 * (10–15 s) e pelo ciclo lento de sync quando o entitlement "sms" está
 * ativo — ciclos sobrepostos são ignorados (o dono corre até ao ack).
 */
export async function syncSmsInbound(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  modules: string[] = []
): Promise<void> {
  if (smsCycleRunning) {
    return;
  }
  smsCycleRunning = true;
  try {
    await syncSmsInboundCycle(prisma, apiUrl, token, log, notifyCtx, modules);
  } finally {
    smsCycleRunning = false;
  }
}

async function syncSmsInboundCycle(
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
  const items =
    (res.body as { messages?: CloudSmsItem[] } | null | undefined)?.messages ??
    [];
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
      shopId: settings.cloudShopId,
      token,
    },
    currency: settings.currency ?? "EUR",
    inbox: { channel: "sms", enabled: isModuleEnabled(settings, "ai-inbox") },
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
  const processed: string[] = [];
  for (const item of items) {
    // Claim síncrono: entre o fetch e este ponto não há await, por isso
    // o segundo poller a ler a fila vê o id já marcado e salta-o.
    if (inFlightIds.has(item.id)) {
      continue;
    }
    inFlightIds.add(item.id);
    processed.push(item.id);
    if (item.kind === "REPORT") {
      if (await applyReport(prisma, log, item)) {
        ackIds.push(item.id);
      }
      continue;
    }
    if (await processReceived(ctx, { apiUrl, token }, item)) {
      ackIds.push(item.id);
    }
  }

  try {
    if (ackIds.length) {
      await cloudFetch(apiUrl, "/sms/inbound/ack", {
        body: { ids: ackIds },
        method: "POST",
        token,
      });
    }
  } finally {
    // Só liberta depois do ack — antes disso a fila devolve as mesmas
    // mensagens ao segundo poller (resposta/decisão duplicada).
    for (const id of processed) {
      inFlightIds.delete(id);
    }
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
      // Livro de ponto: transport=sms — evaluate direto, sempre
      // POR_VALIDAR (sem localização); user.pontoSmsAllowed é o gate.
      ponto: { transport: "sms" },
      plainText: true,
      send: async (text) => {
        const r = await sendSmsViaCloud(c, {
          dedupeId: `bot-${item.id}`,
          // §E.11 — respostas automáticas transliteradas p/ GSM-7: sem
          // isto um acento fora da tabela pagava UCS-2 (segmentos extra).
          text: toSmsText(text),
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
    // Exceção a meio (DB, rede no send, etc.): tenta de novo no próximo
    // poll em vez de confirmar — um pedido de ajuda não pode desaparecer
    // nem a equipa ficar sem o alerta. Passado o teto desiste: uma
    // mensagem permanentemente envenenada não pode bloquear a fila.
    ctx.log.warn({ err, msgId: item.id }, "sms-cloud message failed");
    const attempts = (sendAttempts.get(item.id) ?? 0) + 1;
    sendAttempts.set(item.id, attempts);
    if (attempts >= MAX_SEND_ATTEMPTS) {
      ctx.log.error({ msgId: item.id }, "sms-cloud giving up on message");
      return true;
    }
    return false;
  }
}

/** REPORT → estado de entrega do outbox (dedupeId = outbox entry id). */
async function applyReport(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  item: CloudSmsItem
): Promise<boolean> {
  const status = (item.statusType ?? "").toUpperCase();
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
  /** Um device enabled pode servir a loja (mesma noção do /sms/send). */
  sendable: boolean;
}

/** Estado do device SMS Pro para as Definições — proxy de GET /shops/sms-device. */
export async function getSmsDeviceStatus(
  prisma: DbClient
): Promise<SmsDeviceStatus> {
  const settings = await getOrCreateShopSettings(prisma);
  const base: SmsDeviceStatus = {
    configured: false,
    device: null,
    // Mesmo gate do envio: módulo "sms" com cache fresco — uma lista
    // velha de entitlements não pode apresentar o device como usável.
    entitled: isModuleEnabled(settings, "sms"),
    reachable: false,
    sendable: false,
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
    sendable?: boolean;
  };
  return {
    configured: Boolean(body.configured),
    device: body.device ?? null,
    entitled: true,
    reachable: true,
    // Cloud antiga sem `sendable`: o device default enabled serve de
    // aproximação — cobre o caso comum (loja com o seu próprio telemóvel).
    sendable:
      body.sendable ??
      (body.configured === true && body.device?.enabled === true),
  };
}
