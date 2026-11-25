import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { isModuleEnabled } from "../utils/modules.js";
import {
  type BotReplyCtx,
  handleInboundMessage,
  type InboundMessage,
  InboxPersistError,
  isStopText,
} from "./bot-intents.js";
import { cloudFetch } from "./cloud.service.js";
import { recordInboundMessage } from "./inbox.service.js";
import type { NotifyContext } from "./job.service.js";
import { pontoFieldsFromCloudRow } from "./ponto/inbound.js";
import {
  maskPhone,
  pushCredentialsToCloud,
  resolveWhatsAppChannel,
  sendWhatsAppInteractive,
  sendWhatsAppText,
  type WhatsAppChannel,
} from "./whatsapp-channel.js";

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

// Regra Meta das 24 h (§5.6): resposta livre (incl. IA) só cabe na
// janela — mensagem mais velha não pode receber texto livre. Os
// COMANDOS continuam a executar fora da janela (PARAR revoga
// consentimento, SIM/NÃO decide orçamento, escalada avisa a equipa);
// só o envio da resposta é suprimido com um send que não envia.
const REPLY_WINDOW_MS = 23 * 60 * 60 * 1000; // 23 h — margem antes do corte

// In-memory send-attempt counter — reset on restart, which is fine:
// worst case a message gets one extra retry window.
const sendAttempts = new Map<string, number>();

// Ids em processamento — o poller rápido e o ciclo lento de entitlements
// leem a mesma fila antes do ack; a guarda evita respostas duplicadas.
const inFlightIds = new Set<string>();

// Gravação inbox antes do ack (BUG #164 r8): se o registo local falha,
// a mensagem NÃO é confirmada à Cloud — fica na fila e o próximo ciclo
// retenta com backoff. No limite grava-se uma mensagem FAILED visível
// na caixa de entrada, mas a confirmação à Cloud só acontece depois do
// processamento completo: confirmar num estado de falha perdia comandos
// (ex. PARAR) e, se a própria gravação FAILED falhasse, a mensagem
// sumia sem rasto (BUG #167 r9). A fila não bloqueia — o ack da Cloud é
// por mensagem e as outras seguem.
const MAX_INBOX_PERSIST_ATTEMPTS = 5;
const inboxPersistRetries = new Map<
  string,
  { attempts: number; nextAt: number }
>();

function inboxPersistBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 10 * 60_000);
}

function inboxPersistBackoffActive(msgId: string): boolean {
  const state = inboxPersistRetries.get(msgId);
  return state !== undefined && Date.now() < state.nextAt;
}

/** Nunca confirma: a mensagem fica na fila da Cloud até ser processada.
 *  No limite de tentativas grava o estado FAILED visível na caixa de
 *  entrada (uma vez — o externalId deduplica as repetições). */
async function handleInboxPersistFailure(
  ctx: BotCtx | BotReplyCtx,
  msg: InboundMessage
): Promise<void> {
  const attempts = (inboxPersistRetries.get(msg.id)?.attempts ?? 0) + 1;
  if (attempts === MAX_INBOX_PERSIST_ATTEMPTS) {
    await recordInboundMessage(ctx.prisma, ctx.log, {
      at: new Date(msg.createdAt),
      channel: ctx.inbox?.channel ?? "whatsapp",
      deliveryStatus: "FAILED",
      externalId: msg.id,
      phone: msg.fromPhone,
      text: msg.text ?? `[${msg.messageType}]`,
    }).catch((err) => {
      ctx.log.error(
        { err, msgId: msg.id },
        "whatsapp-bot: falha ao gravar registo FAILED da inbox"
      );
    });
  }
  inboxPersistRetries.set(msg.id, {
    attempts,
    nextAt: Date.now() + inboxPersistBackoffMs(attempts),
  });
}

interface BotCtx extends BotReplyCtx {
  apiUrl: string;
  channel: WhatsAppChannel;
  settings: {
    whatsappApiTokenEncrypted?: string | null;
  };
  token: string;
}

async function sendResult(
  ctx: BotCtx,
  to: string,
  text: string
): Promise<{ error?: string; messageId?: string; success: boolean }> {
  const res = await sendWhatsAppText(
    ctx.prisma,
    ctx.channel,
    `+${to}`,
    text,
    undefined,
    ctx.settings
  );
  if (!res.success) {
    ctx.log.warn(
      { err: res.error, to: maskPhone(to) },
      "whatsapp-bot send failed"
    );
  }
  return res;
}

async function send(ctx: BotCtx, to: string, text: string): Promise<boolean> {
  return (await sendResult(ctx, to, text)).success;
}

/** Interativo Meta para o livro de ponto — o `interactive` é o objeto
 *  Graph tal qual (location_request_message, button); a cloud faz o
 *  passthrough e o modo local fala direto com a Graph API. */
async function sendInteractive(
  ctx: BotCtx,
  to: string,
  interactive: Record<string, unknown>
): Promise<boolean> {
  const res = await sendWhatsAppInteractive(
    ctx.prisma,
    ctx.channel,
    `+${to}`,
    interactive,
    undefined,
    ctx.settings
  );
  if (!res.success) {
    ctx.log.warn(
      { err: res.error, to: maskPhone(to) },
      "whatsapp-bot interactive send failed"
    );
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
  notifyCtx?: NotifyContext,
  modules: string[] = []
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

  // Migração de credenciais: envia o token Meta à cloud na primeira
  // oportunidade — mas só depois do consentimento explícito. Instalações
  // já migradas entram no push para manter o no-op grandfathered centralizado;
  // sem consentimento nem flag não se tenta upload nenhum neste ciclo.
  if (settings.whatsappCloudConsentAt || settings.whatsappCredentialsAtCloud) {
    await pushCredentialsToCloud(prisma);
  }

  await pollWhatsAppInbound(prisma, apiUrl, token, log, notifyCtx, modules);
}

// Um ciclo de cada vez: o poller rápido (10–15 s) e a sync lenta de
// entitlements (via syncWhatsAppBot) chamam os dois esta função e
// GET→process→ACK não é atómico — sem o dono único, um ciclo
// sobreposto lia a fila antes do outro chegar ao claim in-flight e
// a mesma mensagem era respondida duas vezes.
let waCycleRunning = false;

/**
 * Só a parte inbound do sync — o poller rápido (10–15 s) chama isto
 * sem repetir o registo do phone_number_id nem o push de credenciais,
 * que ficam no ciclo lento de entitlements. Ciclos sobrepostos são
 * ignorados: o dono corre até ao ack.
 */
export async function pollWhatsAppInbound(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  modules: string[] = []
): Promise<void> {
  if (waCycleRunning) {
    return;
  }
  waCycleRunning = true;
  try {
    await pollWhatsAppInboundCycle(
      prisma,
      apiUrl,
      token,
      log,
      notifyCtx,
      modules
    );
  } finally {
    waCycleRunning = false;
  }
}

async function pollWhatsAppInboundCycle(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  modules: string[] = []
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  const channel = resolveWhatsAppChannel(settings);
  if (!channel) {
    // ai-inbox sem "whatsapp-bot": a fila oficial continua a ser
    // consumida — a caixa de entrada precisa de TODAS as mensagens e
    // PARAR revoga o consentimento (legal). Respostas automáticas ficam
    // suprimidas: o envio é todo Pro e o resolve devolveu null por isso.
    if (!isModuleEnabled(settings, "ai-inbox")) {
      return;
    }
    await drainInboxOnly(prisma, apiUrl, token, log, notifyCtx, settings);
    return;
  }
  // Transporte Evolution: a fila oficial só pode ser respondida com os
  // gates do §5.7 — termo do bot aceite e bot não suspenso. Sem isto,
  // mensagens Meta pendentes respondiam pelo transporte não-oficial
  // logo após a mudança, contornando a suspensão. Mesmo bloqueado, os
  // PARAR/STOP têm de ser consumidos: a revogação de consentimento é
  // legal e não pode esperar pelo bot (o outbox continuava a notificar).
  const blockedEvolution =
    channel.mode === "evolution" &&
    !(settings.whatsappBotDisclaimerAt && !settings.whatsappBotSuspendedAt);

  const res = await cloudFetch(apiUrl, "/whatsapp/inbound", { token });
  if (!res.ok) {
    return;
  }
  const messages = (res.body as { messages?: InboundMessage[] }).messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const ctx: BotCtx = {
    ai: {
      apiUrl,
      avgRepairDaysAfterPart: settings.botAvgRepairDaysAfterPart,
      botInfoText: settings.botInfoText,
      channel: channel.mode === "evolution" ? "evolution" : "whatsapp",
      enabled: settings.botAiEnabled,
      module: "whatsapp-bot",
      modules,
      token,
    },
    apiUrl,
    channel,
    currency: settings.currency ?? "EUR",
    inbox: {
      channel: channel.mode === "evolution" ? "evolution" : "whatsapp",
      enabled: isModuleEnabled(settings, "ai-inbox"),
    },
    log,
    notifyCtx,
    portalApiUrl: apiUrl,
    portalEnabled: modules.includes("portal"),
    pontoOnly: settings.shopMode === "ponto_only",
    prisma,
    timezone: settings.timezone ?? process.env.TZ ?? "UTC",
    settings,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
    token,
  };

  await drainInbound(ctx, messages, blockedEvolution);
}

/** Processa uma mensagem no consumo record-only. Devolve true se pode
 *  ser confirmada à Cloud. */
async function processInboxOnlyMessage(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  log: FastifyBaseLogger
): Promise<boolean> {
  // silentSend: o pipeline corre (registo + PARAR + escalada) mas o
  // envio é no-op — sem canal resolvido nada sai para o cliente.
  // allowQuoteDecision=false: sem canal real de resposta, SIM/NÃO não
  // pode aprovar/rejeitar orçamentos em silêncio.
  try {
    await handleInboundMessage(ctx, msg, {
      allowQuoteDecision: false,
      channelLabel: "WhatsApp",
      requireInboxPersist: true,
      send: () => Promise.resolve(true),
      silentSend: true,
    });
    inboxPersistRetries.delete(msg.id);
    return true;
  } catch (err) {
    if (err instanceof InboxPersistError) {
      // Sem registo local: retry com backoff; no limite grava FAILED.
      await handleInboxPersistFailure(ctx, msg);
      return false;
    }
    // Poisoned — regista e confirma na mesma para não bloquear a fila.
    log.warn({ err, msgId: msg.id }, "whatsapp inbox record falhou");
    return true;
  }
}

/**
 * Consumo record-only da fila oficial — modo ai-inbox sem
 * "whatsapp-bot". Cada mensagem entra na caixa de entrada e o pipeline
 * corre com envio suprimido (PARAR revoga consentimento; pedidos de
 * ajuda escalam ao staff). Sem transporte resolvido nada é enviado —
 * a resposta automática é funcionalidade do bot, não da inbox.
 */
async function drainInboxOnly(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  settings: Awaited<ReturnType<typeof getOrCreateShopSettings>>
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/whatsapp/inbound", { token });
  if (!res.ok) {
    return;
  }
  const messages = (res.body as { messages?: InboundMessage[] }).messages ?? [];
  if (messages.length === 0) {
    return;
  }
  const ctx: BotReplyCtx = {
    currency: settings.currency ?? "EUR",
    inbox: { channel: "whatsapp", enabled: true },
    log,
    notifyCtx,
    pontoOnly: settings.shopMode === "ponto_only",
    prisma,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
    timezone: settings.timezone ?? process.env.TZ ?? "UTC",
  };
  const ackIds: string[] = [];
  const processed: string[] = [];
  for (const msg of messages) {
    if (inFlightIds.has(msg.id) || inboxPersistBackoffActive(msg.id)) {
      continue;
    }
    inFlightIds.add(msg.id);
    processed.push(msg.id);
    if (await processInboxOnlyMessage(ctx, msg, log)) {
      ackIds.push(msg.id);
    }
  }
  try {
    if (ackIds.length) {
      await cloudFetch(apiUrl, "/whatsapp/inbound/ack", {
        body: { ids: ackIds },
        method: "POST",
        token,
      });
    }
  } finally {
    for (const id of processed) {
      inFlightIds.delete(id);
    }
  }
}

/**
 * Consome a fila com dedupe in-flight (só liberta após o ack — antes
 * disso a fila devolve as mensagens e o ciclo lento re-processava-as).
 * `silent` = bot Evolution bloqueado: só PARAR/STOP são processados
 * (revogação legal sem confirmação); o resto fica na fila.
 */
async function drainInbound(
  ctx: BotCtx,
  messages: InboundMessage[],
  silent: boolean
): Promise<void> {
  const ackIds: string[] = [];
  const processed: string[] = [];
  for (const msg of messages) {
    if (inFlightIds.has(msg.id)) {
      continue;
    }
    if (silent && !isStopText(msg.text ?? "")) {
      continue;
    }
    inFlightIds.add(msg.id);
    processed.push(msg.id);
    if (await processInbound(ctx, msg, silent)) {
      ackIds.push(msg.id);
    }
  }

  try {
    if (ackIds.length) {
      await cloudFetch(ctx.apiUrl, "/whatsapp/inbound/ack", {
        body: { ids: ackIds },
        method: "POST",
        token: ctx.token,
      });
    }
  } finally {
    for (const id of processed) {
      inFlightIds.delete(id);
    }
  }
}

/**
 * Processa uma mensagem inbound. Devolve true se pode ser confirmada.
 * `silent` = bot Evolution bloqueado: nunca envia nem decide orçamento —
 * só os PARAR/STOP lá chegam e só precisam da revogação aplicada.
 */
async function processInbound(
  ctx: BotCtx,
  msg: InboundMessage,
  silent = false
): Promise<boolean> {
  if (inboxPersistBackoffActive(msg.id)) {
    return false; // backoff da gravação inbox — não confirma, o próximo ciclo tenta
  }
  const age = Date.now() - Date.parse(msg.createdAt);
  const stale = Number.isFinite(age) && age > REPLY_WINDOW_MS;
  if (stale) {
    ctx.log.warn(
      { msgId: msg.id, ageMinutes: Math.round(age / 60_000) },
      "whatsapp-bot: fora da janela de 24 h — comandos executados, resposta suprimida"
    );
  }
  try {
    // Livro de ponto: a fila pode trazer campos estruturados (location
    // coords, button_reply id) que o tipo InboundMessage não declara —
    // o mapper extrai-os sem tocar no resto do pipeline.
    const pontoMsg: InboundMessage = {
      ...msg,
      ...pontoFieldsFromCloudRow(msg as InboundMessage & { payload?: unknown }),
    };
    const out = await handleInboundMessage(ctx, pontoMsg, {
      // Fora da janela: SIM/NÃO não decide — o orçamento pendente pode
      // ter sido enviado depois desta mensagem e a decisão ficaria
      // registada no errado sem confirmação ao cliente.
      allowQuoteDecision: !(stale || silent),
      channelLabel: "WhatsApp",
      // Livro de ponto: transport=whatsapp_meta (a marcação chegou pelo
      // número oficial). Interativo só fora da janela de 24 h — lá fora
      // a Meta rejeita business-initiated e o handler cai em texto.
      ponto: {
        interactive:
          stale || silent || ctx.channel.mode === "evolution"
            ? undefined
            : (interactive) => sendInteractive(ctx, msg.fromPhone, interactive),
        transport: "whatsapp_meta",
      },
      requireInboxPersist: true,
      // Fora da janela ou bot bloqueado: nunca envia — corre o pipeline
      // (PARAR/SIM/NÃO/escalada) com envio suprimido.
      send:
        stale || silent
          ? () => Promise.resolve(true)
          : (text) => send(ctx, msg.fromPhone, text),
      // O relay devolve o wamid — `sendWithId` expõe-o às perguntas de
      // seguimento do lembrete de saída (citação do trabalhador).
      sendWithId:
        stale || silent
          ? undefined
          : (text) => sendResult(ctx, msg.fromPhone, text),
      silentSend: stale || silent,
    });
    inboxPersistRetries.delete(msg.id);
    if (!out) {
      return true; // flood — descarta sem responder
    }
    if (out.sent) {
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
    if (err instanceof InboxPersistError) {
      // Sem registo local: retry com backoff; no limite grava FAILED.
      await handleInboxPersistFailure(ctx, msg);
      return false;
    }
    ctx.log.warn({ err, msgId: msg.id }, "whatsapp-bot message failed");
    return true; // poisoned — don't loop forever
  }
}
