import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { isModuleEnabled } from "../utils/modules.js";
import {
  type BotReplyCtx,
  escalateToStaff,
  findCustomersByPhone,
  handleInboundMessage,
  type InboundMessage,
  rateOk,
} from "./bot-intents.js";
import {
  type EvolutionConfig,
  getEvolutionState,
  sendEvolutionPresence,
  sendEvolutionText,
} from "./evolution.service.js";
import type { NotifyContext } from "./job.service.js";

/**
 * §5.7 — bot WhatsApp sobre Evolution API (transporte não-oficial).
 *
 * Pro (`whatsapp-bot` nos entitlements) + termo do bot aceite
 * (`whatsappBotDisclaimerAt`, separado do disclaimer do transporte).
 * As proteções anti-ban são obrigatórias — responder como um humano:
 * só clientes, só texto, dedupe, atraso com "a escrever…", 10/h por
 * número e teto diário por instância. Erro de sessão suspende o bot
 * (`whatsappBotSuspendedAt`) até o termo ser aceite de novo.
 */

const RATE_LIMIT_PER_HOUR = 10;
const DEFAULT_DAILY_CAP = 200;
const REPLY_DELAY_MIN_MS = 3000;
const REPLY_DELAY_SPREAD_MS = 5000;
const DEDUPE_MAX = 5000;
const UPSERT_EVENT = "messages.upsert";
const GROUP_SUFFIX_RE = /@(g\.us|broadcast|newsletter)$/i;
const NON_DIGIT_RE = /\D/g;
const SESSION_STATES = new Set(["close"]);

// Dedupe por id da mensagem — a Evolution re-entrega MESSAGES_UPSERT ao
// reconectar. Em memória: reiniciar a app aceita uma re-entrega isolada,
// o que é preferível a guardar ids numa tabela sem TTL.
const seenMessageIds = new Set<string>();
// Teto de notificações ao staff por remetente/hora — cobre número
// desconhecido e mídia não-texto (anti-flood do inbox do staff).
const STAFF_NOTIFY_LIMIT_PER_HOUR = 2;
let dayBucket = "";
let dayCount = 0;
let dayCapNotified = false;

interface EvolutionUpsertData {
  key?: { fromMe?: boolean; id?: string; remoteJid?: string };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
  };
  messageTimestamp?: number;
  messageType?: string;
  pushName?: string;
}

interface EvolutionEnvelope {
  data?: EvolutionUpsertData | { messages?: EvolutionUpsertData[] };
  event?: string;
}

interface ParsedInbound {
  /** null quando a mensagem não é texto — escala ao staff sem resposta. */
  data: EvolutionUpsertData;
  fromPhone: string;
  id: string;
  text: string | null;
}

/** Envelope Evolution → mensagens normalizadas já filtradas (anti-ban). */
function parseUpserts(envelope: EvolutionEnvelope): ParsedInbound[] {
  const event = (envelope.event ?? "").toLowerCase();
  if (event !== UPSERT_EVENT) {
    return [];
  }
  const raw = envelope.data;
  let items: EvolutionUpsertData[] = [];
  if (raw && "messages" in raw && Array.isArray(raw.messages)) {
    items = raw.messages;
  } else if (raw && "key" in (raw as EvolutionUpsertData)) {
    items = [raw as EvolutionUpsertData];
  }
  const out: ParsedInbound[] = [];
  for (const data of items) {
    const jid = data.key?.remoteJid ?? "";
    // Anti-ban: ignora o que sai do próprio número, grupos, broadcast e
    // newsletters — responder a esses é o padrão clássico de bot banido.
    if (data.key?.fromMe || !jid || GROUP_SUFFIX_RE.test(jid)) {
      continue;
    }
    const id = data.key?.id;
    if (!id || seenMessageIds.has(id)) {
      continue;
    }
    if (seenMessageIds.size >= DEDUPE_MAX) {
      seenMessageIds.clear();
    }
    seenMessageIds.add(id);
    const text =
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      null;
    out.push({ data, fromPhone: jid.replace(NON_DIGIT_RE, ""), id, text });
  }
  return out;
}

function dailyCapExceeded(cap: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dayBucket !== today) {
    dayBucket = today;
    dayCount = 0;
    dayCapNotified = false;
  }
  if (dayCount < cap) {
    return false;
  }
  return true;
}

/** Suspende o bot e avisa o staff — erro de sessão/bloqueio da Evolution. */
async function suspendBot(
  prisma: PrismaClient,
  ctx: BotReplyCtx,
  msg: InboundMessage
): Promise<void> {
  await prisma.shopSettings.update({
    data: { whatsappBotSuspendedAt: new Date() },
    where: { id: "default" },
  });
  ctx.log.warn(
    "evolution-bot: sessão fechada — bot suspenso até re-aceite do termo"
  );
  await escalateToStaff(
    ctx,
    "WhatsApp (sessão caiu — bot suspenso)",
    msg,
    null,
    null
  );
}

type Settings = Awaited<ReturnType<typeof getOrCreateShopSettings>>;

function entitlementsOf(settings: Settings): string[] {
  return Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[]).filter(
        (m): m is string => typeof m === "string"
      )
    : [];
}

/** Gates do §5.7: transporte Evolution + WhatsApp ligado + termo do bot
 * aceite + não suspenso + entitlement "whatsapp-bot" FRESCO. Sem isso a
 * rota devolve 200 sem processar — grátis não tem bot. O entitlement é
 * validado com isModuleEnabled (cache de 24 h): uma loja desligada da
 * Cloud não fica a responder para sempre numa lista de módulos velha. */
function botGateOpen(settings: Settings): boolean {
  return Boolean(
    settings.whatsappEnabled &&
      settings.whatsappTransport === "evolution" &&
      settings.whatsappBotDisclaimerAt &&
      !settings.whatsappBotSuspendedAt &&
      isModuleEnabled(settings, "whatsapp-bot")
  );
}

function evolutionConfigOf(settings: Settings): EvolutionConfig | null {
  const apiKey = settings.evolutionApiKeyEncrypted
    ? decryptSecret(settings.evolutionApiKeyEncrypted)
    : null;
  if (!(settings.evolutionUrl && apiKey)) {
    return null;
  }
  return {
    apiKey,
    baseUrl: settings.evolutionUrl,
    instance: settings.evolutionInstance ?? "oficinaos",
  };
}

function buildCtx(
  prisma: PrismaClient,
  settings: Settings,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  modules: string[]
): BotReplyCtx {
  const cloudToken = settings.cloudShopTokenEncrypted
    ? decryptSecret(settings.cloudShopTokenEncrypted)
    : null;
  return {
    ai:
      cloudToken && settings.cloudApiUrl
        ? {
            apiUrl: settings.cloudApiUrl,
            avgRepairDaysAfterPart: settings.botAvgRepairDaysAfterPart,
            botInfoText: settings.botInfoText,
            channel: "evolution",
            enabled: settings.botAiEnabled,
            module: "whatsapp-bot",
            modules,
            token: cloudToken,
          }
        : undefined,
    currency: settings.currency ?? "EUR",
    log,
    notifyCtx,
    portalApiUrl: settings.cloudApiUrl,
    portalEnabled: modules.includes("portal"),
    prisma,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
  };
}

/** Send "humano": presença a escrever + atraso 3–8 s + texto. */
function makeSend(
  prisma: PrismaClient,
  ctx: BotReplyCtx,
  config: EvolutionConfig,
  msg: InboundMessage,
  log: FastifyBaseLogger
): (text: string) => Promise<boolean> {
  return async (text) => {
    const delay = REPLY_DELAY_MIN_MS + Math.random() * REPLY_DELAY_SPREAD_MS;
    await sendEvolutionPresence(config, msg.fromPhone, delay).catch(() => null);
    await new Promise((r) => setTimeout(r, delay));
    const res = await sendEvolutionText(config, msg.fromPhone, text);
    if (!res.success) {
      log.warn(
        { err: res.error, to: msg.fromPhone },
        "evolution-bot reply failed"
      );
      // Erro de sessão/bloqueio: confirma o estado e suspende o bot.
      const state = await getEvolutionState(
        config.baseUrl,
        config.apiKey,
        config.instance
      ).catch(() => "unreachable" as const);
      if (SESSION_STATES.has(state)) {
        await suspendBot(prisma, ctx, msg).catch((err) =>
          log.warn({ err }, "evolution-bot suspend failed")
        );
      }
    }
    return res.success;
  };
}

/**
 * Processa um envelope MESSAGES_UPSERT da Evolution (webhook LAN).
 * Chamado só depois de o token da rota validar; cada proteção abaixo é
 * uma exigência do plano anti-ban, não opcional.
 */
export async function handleEvolutionInbound(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  envelope: EvolutionEnvelope
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!botGateOpen(settings)) {
    return;
  }
  const config = evolutionConfigOf(settings);
  if (!config) {
    return;
  }
  const ctx = buildCtx(
    prisma,
    settings,
    log,
    notifyCtx,
    entitlementsOf(settings)
  );
  const cap = settings.whatsappBotDailyCap ?? DEFAULT_DAILY_CAP;
  for (const parsed of parseUpserts(envelope)) {
    const msg: InboundMessage = {
      createdAt: parsed.data.messageTimestamp
        ? new Date(parsed.data.messageTimestamp * 1000).toISOString()
        : new Date().toISOString(),
      fromPhone: parsed.fromPhone,
      id: `evo-${parsed.id}`,
      // A Evolution etiqueta texto como "conversation"/"extendedTextMessage"
      // — o pipeline partilhado só reconhece "text"; o resto escala ao staff.
      messageType: parsed.text === null ? "other" : "text",
      text: parsed.text,
    };
    await processOne(prisma, ctx, config, msg, parsed, cap, log);
  }
}

async function processOne(
  prisma: PrismaClient,
  ctx: BotReplyCtx,
  config: EvolutionConfig,
  msg: InboundMessage,
  parsed: ParsedInbound,
  cap: number,
  log: FastifyBaseLogger
): Promise<void> {
  // Não-texto escala ao staff sem resposta automática; número que não é
  // cliente igual — as duas regras são linha dura do plano anti-ban. O
  // matching é o mesmo do pipeline partilhado (dígitos normalizados +
  // sufixo só para remetente PT): clientes guardados como "912345678"
  // ou "+351912345678" têm de casar o JID internacional do remetente.
  const isText = parsed.text !== null && parsed.text.trim() !== "";
  const customers = isText
    ? await findCustomersByPhone(prisma, parsed.fromPhone)
    : [];
  if (!(isText && customers.length > 0)) {
    if (rateOk(`esc:${parsed.fromPhone}`, STAFF_NOTIFY_LIMIT_PER_HOUR)) {
      await escalateToStaff(ctx, "WhatsApp", msg, null, null).catch((err) =>
        log.warn({ err }, "evolution-bot escalate failed")
      );
    }
    return;
  }
  if (dailyCapExceeded(cap)) {
    if (!dayCapNotified) {
      dayCapNotified = true;
      log.warn({ cap }, "evolution-bot: teto diário de respostas atingido");
      await escalateToStaff(
        ctx,
        "WhatsApp (teto diário atingido)",
        msg,
        null,
        null
      ).catch((err) => log.warn({ err }, "evolution-bot cap notify failed"));
    }
    return;
  }

  // Reserva o slot diário ANTES da resposta (inclui o atraso "a
  // escrever…") — contar só depois do envio deixava duas mensagens
  // segundos apartadas passarem as duas pelo último slot.
  dayCount += 1;
  const out = await handleInboundMessage(ctx, msg, {
    channelLabel: "WhatsApp",
    rateLimitPerHour: RATE_LIMIT_PER_HOUR,
    send: makeSend(prisma, ctx, config, msg, log),
  });
  // Descartada pelo limite horário ou processada sem resposta ao
  // cliente (PARAR acima do teto, SIM/NÃO fora da janela) — a vaga
  // diária não foi realmente usada: devolve-a para um cliente abusivo
  // não esgotar o teto dos outros.
  if (out === null || out.reply.text.length === 0) {
    dayCount -= 1;
  }
}
