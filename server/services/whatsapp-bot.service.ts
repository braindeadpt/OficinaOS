import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import {
  type BotReplyCtx,
  composeReply,
  escalateToStaff,
  type InboundMessage,
  rateOk,
} from "./bot-intents.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { decryptWhatsAppConfig, sendWhatsApp } from "./notification-sender.js";

/**
 * WhatsApp bot (módulo "whatsapp-bot"): a cloud fila mensagens inbound
 * que chegam pelo webhook da Meta; a app faz poll, casa o remetente com
 * um cliente pelo número de telefone e responde com dados da ficha
 * (estado, orçamento, aceitação por SIM/NÃO). Responder a inbound é
 * comunicação de serviço na janela de 24h — whatsappConsent só é
 * exigido para notificações iniciadas pela loja.
 *
 * A lógica de intents vive em bot-intents.ts, partilhada com o canal
 * SMS — este ficheiro trata só do transporte (poll + ack + envio Meta).
 */

const MAX_SEND_ATTEMPTS = 3;

// In-memory send-attempt counter — reset on restart, which is fine:
// worst case a message gets one extra retry window.
const sendAttempts = new Map<string, number>();

interface BotCtx extends BotReplyCtx {
  apiUrl: string;
  token: string;
  waConfig: NonNullable<ReturnType<typeof decryptWhatsAppConfig>>;
}

async function send(ctx: BotCtx, to: string, text: string): Promise<boolean> {
  const res = await sendWhatsApp(ctx.waConfig, `+${to}`, text);
  if (!res.success) {
    ctx.log.warn({ err: res.error, to: `+${to}` }, "whatsapp-bot send failed");
  }
  return res.success;
}

/**
 * Chamado pelo poller quando a loja tem "whatsapp-bot": regista o
 * phone_number_id na cloud, recolhe inbound e responde via Graph API.
 */
export async function syncWhatsAppBot(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);

  // Regista o phone_number_id na cloud para o webhook saber a que loja
  // entregar as mensagens. Idempotente — um POST por ciclo é barato.
  if (settings.whatsappPhoneNumberId) {
    await cloudFetch(apiUrl, "/shops/whatsapp-config", {
      body: { phoneNumberId: settings.whatsappPhoneNumberId },
      method: "POST",
      token,
    }).catch(() => null);
  }

  const waConfig = settings.whatsappEnabled
    ? decryptWhatsAppConfig({
        apiTokenEncrypted: settings.whatsappApiTokenEncrypted ?? "",
        businessId: settings.whatsappBusinessId ?? "",
        phoneNumberId: settings.whatsappPhoneNumberId ?? "",
      })
    : null;
  if (!waConfig) {
    return; // módulo ativo mas WhatsApp por configurar — fila fica a aguardar
  }

  const res = await cloudFetch(apiUrl, "/whatsapp/inbound", { token });
  if (!res.ok) {
    return;
  }
  const messages = (res.body as { messages?: InboundMessage[] }).messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const ctx: BotCtx = {
    apiUrl,
    currency: settings.currency ?? "EUR",
    log,
    notifyCtx,
    prisma,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
    token,
    waConfig,
  };

  const ackIds: string[] = [];
  for (const msg of messages) {
    if (await processInbound(ctx, msg)) {
      ackIds.push(msg.id);
    }
  }

  if (ackIds.length) {
    await cloudFetch(apiUrl, "/whatsapp/inbound/ack", {
      body: { ids: ackIds },
      method: "POST",
      token,
    });
  }
}

/** Processa uma mensagem inbound. Devolve true se pode ser confirmada. */
async function processInbound(
  ctx: BotCtx,
  msg: InboundMessage
): Promise<boolean> {
  if (!rateOk(msg.fromPhone)) {
    return true; // flood — descarta sem responder
  }
  try {
    const out = await composeReply(ctx, msg);
    const sent = await send(ctx, msg.fromPhone, out.text);
    if (out.escalate) {
      await escalateToStaff(
        ctx,
        "WhatsApp",
        msg,
        out.customerName,
        out.jobId
      ).catch((err) => ctx.log.warn({ err }, "whatsapp-bot escalate failed"));
    }
    if (sent) {
      return true;
    }
    const attempts = (sendAttempts.get(msg.id) ?? 0) + 1;
    sendAttempts.set(msg.id, attempts);
    if (attempts >= MAX_SEND_ATTEMPTS) {
      ctx.log.error({ msgId: msg.id }, "whatsapp-bot giving up on message");
      return true;
    }
    return false;
  } catch (err) {
    ctx.log.warn({ err, msgId: msg.id }, "whatsapp-bot message failed");
    return true; // poisoned — don't loop forever
  }
}
