import type { PrismaClient } from "@generated/client";
import { Role } from "@generated/client";
import { effectiveDialCode } from "@shared/constants/countries.js";
import { ACTIVE_STATUSES } from "@shared/constants/job-statuses.js";
import type { FastifyBaseLogger } from "fastify";
import {
  createManyAndReturnInAppNotifications,
  findManyUsers,
} from "../repositories/notification.repository.js";
import type { DbClient } from "../repositories/types.js";
import { askBotAi } from "./bot-ai.js";
import type { BotToolCtx } from "./bot-tools.js";
import {
  escalateConversation,
  getConversationHistory,
  INBOX_HANDLED_BOT,
  recordInboundMessage,
  recordOutboundMessage,
} from "./inbox.service.js";
import type { NotifyContext } from "./job.service.js";
import { respondToQuote } from "./job-quote.service.js";
import { tryHandlePontoStaff } from "./ponto/handler.js";
import { rateOk } from "./rate-limit.js";

/**
 * Transporte do bot de clientes — WP0.4 (enforcement). A lógica de
 * regras (estado, orçamento SIM/NÃO, códigos REP) vive TODA na Cloud:
 * aqui monta-se o contexto (clientes/jobs do remetente), chama-se
 * /ai/bot-reply e executam-se as ações devolvidas (consentimento,
 * decisão de orçamento) com validação local — a Cloud não toca na BD
 * da loja. Cloud em baixo → escala para staff ("a loja responde-te já"),
 * tradeoff aceite pelo dono: sem enforcement uma app alterada tinha o
 * bot de graça.
 *
 * Exceção deliberada: PARAR/STOP exatos revogam o consentimento
 * localmente ANTES de qualquer chamada — obrigação legal que tem de
 * valer mesmo com a Cloud em baixo. É plumbing legal, não lógica do bot.
 */
const STOP_WORDS = new Set(["parar", "stop"]);

/** Opt-out transversal — true para PARAR/STOP exatos (case-insensitive). */
export function isStopText(text: string): boolean {
  return STOP_WORDS.has(text.trim().toLowerCase());
}
const INTL_PREFIX_RE = /^00/;
const DIGITS_RE = /\D/g;
const WA_BOLD_RE = /\*/g;

export interface InboundMessage {
  createdAt: string;
  fromPhone: string;
  id: string;
  /** Referência a imagem recebida — hoje só a Evolution expõe a mensagem
   *  crua (download via getBase64FromMediaMessage); `raw` leva a message
   *  completa para esse endpoint. */
  imageRef?: {
    mimetype?: string | null;
    raw?: unknown;
    url?: string | null;
  };
  /** Id de botão interativo respondido (Meta button_reply/list_reply ou
   *  Evolution buttonsResponse/listResponse). */
  interactiveId?: string | null;
  /** Localização partilhada — módulo ponto (payload WhatsApp oficial ou
   *  locationMessage da Evolution). Coordenadas WGS84. */
  location?: { accuracy?: number; lat: number; lng: number };
  messageType: string;
  /** Id da mensagem citada (reply-quote do WhatsApp): stanzaId da
   *  Evolution ou context.id da Meta quando a fila cloud o expõe —
   *  o livro de ponto correlaciona a resposta ao lembrete de saída
   *  com a pergunta enviada. */
  quotedMessageId?: string;
  /** Hora de ENVIO segundo o canal (sentAt da Meta na fila oficial) —
   *  o livro de ponto mede a validade do código e a frescura do
   *  registo a partir daqui; ausente → createdAt (hora de receção). */
  sentAt?: string;
  text: string | null;
}

export interface BotAiChannelConfig {
  apiUrl: string;
  avgRepairDaysAfterPart: number;
  botInfoText: string | null;
  channel: "evolution" | "sms" | "whatsapp";
  /** settings.botAiEnabled — flag de rollout; off → só regras. */
  enabled: boolean;
  /** Módulo cujo entitlement é exigido p/ este canal ("sms", "whatsapp-bot"). */
  module: string;
  /** Módulos ativos conforme último sync de entitlements. */
  modules: string[];
  /** Token da loja na Cloud (bearer do /ai/bot-reply). */
  token: string;
}

export interface BotReplyCtx {
  ai?: BotAiChannelConfig;
  currency: string;
  /** Caixa de entrada (§G): quando o módulo "ai-inbox" está ativo,
   *  inbound/outbound do bot gravam-se em BusinessMessage e a IA lê o
   *  histórico da conversa persistida. Canal da conversa: whatsapp |
   *  evolution | sms. */
  inbox?: { channel: string; enabled: boolean };
  log: FastifyBaseLogger;
  notifyCtx: NotifyContext | undefined;
  /** Cloud API base para o link do portal na vistaCliente (null → sem link). */
  portalApiUrl?: string | null;
  /** true quando o módulo "portal" está ativo nos entitlements. */
  portalEnabled?: boolean;
  prisma: PrismaClient;
  shopLabel: string;
  /** IANA timezone da loja — datas apresentadas ao cliente (previsões,
   *  chegadas de peças) renderizam-se aqui, não no fuso do servidor. */
  timezone?: string;
}
/** Notifica staff in-app e avisa o cliente que um humano responde. */
export async function escalateToStaff(
  ctx: BotReplyCtx,
  channelLabel: string,
  msg: InboundMessage,
  customerName: string | null,
  jobId: string | null
): Promise<void> {
  const staff = await findManyUsers(
    ctx.prisma,
    { isActive: true, role: { in: [Role.OWNER, Role.FRONT_DESK] } },
    { id: true }
  );
  if (staff.length === 0) {
    return;
  }
  // O número acompanha sempre o nome — clientes homónimos e respostas
  // sem reparação associada (SIM/NÃO fora da janela) ficam seguiveis.
  // O gateway SMS já manda o «+» — normaliza para não duplicar.
  const phone = msg.fromPhone.startsWith("+")
    ? msg.fromPhone
    : `+${msg.fromPhone}`;
  const who = customerName ? `${customerName} (${phone})` : phone;
  const snippet = (msg.text ?? `[${msg.messageType}]`).slice(0, 200);
  const created = await createManyAndReturnInAppNotifications(
    ctx.prisma,
    staff.map((u) => ({
      jobId,
      message: `${channelLabel} de ${who}: "${snippet}"`,
      type: "whatsapp_inbound",
      userId: u.id,
    }))
  );
  const ids = new Set(staff.map((u) => u.id));
  for (const n of created) {
    ctx.notifyCtx?.wsBroadcast?.((c) => ids.has(c.userId), {
      notification: {
        createdAt: n.createdAt,
        id: n.id,
        job: jobId ? { id: jobId, jobCode: "" } : null,
        message: n.message,
        readAt: null,
        type: n.type,
      },
      type: "NOTIFICATION",
    });
  }
}

interface ActiveJob {
  customer: { name: string };
  device: { model: string; brand: { name: string } };
  estimatedDate: Date | null;
  id: string;
  jobCode: string;
  partsWaiting?: { expectedAt: Date | null; partName: string }[];
  quotes: {
    id: string;
    version: number;
    amount: { toNumber(): number };
    note: string | null;
    sentAt: Date | null;
    status: string;
  }[];
  status: string;
}

interface CustomerMatch {
  customers: { id: string; name: string }[];
  jobs: ActiveJob[];
}

/** Casa um telefone com clientes.
 *
 * Remetente com número nacional PT (9 dígitos) ou +351 casa pelo sufixo
 * — a loja pode ter o número guardado sem indicativo. Remetente com
 * outro indicativo só casa por número completo: os últimos 9 dígitos de
 * um +34 são iguais aos de um cliente PT e o bot daria a ficha dele a um
 * estranho (sec: a ficha leva histórico e dados da reparação).
 *
 * O sufixo de 9 dígitos só existe quando o envio da loja usa o
 * indicativo português — countryCode "PT" ou um valor legado/
 * desconhecido que formatPhone já trata como +351 (ex.: "DZ" das
 * primeiras instalações). Num país suportado com outro indicativo o
 * número nacional do cliente pode ter 9 dígitos sem ser português e um
 * remetente +351 com o mesmo sufixo herdava a ficha de um estranho.
 * Essas lojas casam só por número completo — fichas nacionais devem
 * guardar-se com indicativo.
 *
 * Partilhado pelo pipeline (findCustomerJobs) e pelo gate "só clientes"
 * do bot Evolution — as duas superfícies têm de casar da mesma forma.
 */
export async function findCustomersByPhone(
  prisma: DbClient,
  fromPhone: string
): Promise<{ id: string; name: string }[]> {
  const senderDigits = fromPhone
    .replace(DIGITS_RE, "")
    .replace(INTL_PREFIX_RE, "");
  const PT_CC = "351";
  const ptLike = (d: string) =>
    d.length === 9 || (d.startsWith(PT_CC) && d.length === 12);
  const isPtSender = ptLike(senderDigits);
  const shop = await prisma.shopSettings.findUnique({
    select: { countryCode: true },
    where: { id: "default" },
  });
  const shopUsesPtDialCode = effectiveDialCode(shop?.countryCode) === PT_CC;
  const last9 = senderDigits.slice(-9);
  const last4 = senderDigits.slice(-4);
  if ((isPtSender && last9.length < 9) || last4.length < 4) {
    return [];
  }
  // Pré-filtro pelos últimos 4 dígitos sem separadores: a ficha pode ter
  // «+351 912 345 678» ou «(912 345 678 )» — o casamento exato faz-se
  // abaixo sobre os dígitos.
  const candidates = await prisma.$queryRaw<
    { id: string; name: string; phone: string }[]
  >`
    SELECT id, name, phone FROM customers
    WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${`%${last4}`}
  `;
  return candidates
    .filter((c) => {
      const cd = c.phone.replace(DIGITS_RE, "").replace(INTL_PREFIX_RE, "");
      if (cd === senderDigits) {
        return true;
      }
      // Sufixo só vale entre números PT quando a loja envia em +351 —
      // uma ficha estrangeira com os mesmos 9 dígitos finais não é o
      // mesmo cliente.
      return (
        isPtSender && shopUsesPtDialCode && ptLike(cd) && cd.slice(-9) === last9
      );
    })
    .map(({ id, name }) => ({ id, name }));
}

/** Casa o remetente com clientes e traz jobs ativos. */
async function findCustomerJobs(
  ctx: BotReplyCtx,
  fromPhone: string
): Promise<CustomerMatch> {
  const customers = await findCustomersByPhone(ctx.prisma, fromPhone);
  if (customers.length === 0) {
    return { customers: [], jobs: [] };
  }
  const jobs = (await ctx.prisma.job.findMany({
    where: {
      customerId: { in: customers.map((c) => c.id) },
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      jobCode: true,
      status: true,
      estimatedDate: true,
      customer: { select: { name: true } },
      device: { select: { model: true, brand: { select: { name: true } } } },
      partsWaiting: {
        orderBy: { createdAt: "asc" as const },
        select: { expectedAt: true, partName: true },
      },
      quotes: {
        orderBy: { version: "desc" as const },
        take: 1,
        select: {
          id: true,
          version: true,
          amount: true,
          note: true,
          sentAt: true,
          status: true,
        },
      },
    },
  })) as unknown as ActiveJob[];
  return { customers, jobs };
}

export interface BotReply {
  customerName: string | null;
  escalate: boolean;
  jobId: string | null;
  text: string;
}

function serializeJobs(jobs: ActiveJob[]) {
  return jobs.map((j) => ({
    customerName: j.customer.name,
    deviceName: `${j.device.brand.name} ${j.device.model}`,
    estimatedDate: j.estimatedDate?.toISOString() ?? null,
    id: j.id,
    jobCode: j.jobCode,
    partsWaiting: (j.partsWaiting ?? []).map((p) => ({
      expectedAt: p.expectedAt?.toISOString() ?? null,
      partName: p.partName,
    })),
    quotes: j.quotes.map((q) => ({
      amount: q.amount.toNumber(),
      id: q.id,
      note: q.note,
      sentAt: q.sentAt?.toISOString() ?? null,
      status: q.status,
      version: q.version,
    })),
    status: j.status,
  }));
}

/** Executa a ação devolvida pelas regras da Cloud — a validação e os
 *  efeitos na BD da loja são locais; a composição dos textos fica na
 *  Cloud, a escolha aqui é plumbing. */
async function executeCloudAction(
  ctx: BotReplyCtx,
  res: NonNullable<Awaited<ReturnType<typeof askBotAi>>>,
  msg: InboundMessage,
  customers: { id: string; name: string }[],
  replyText: string
): Promise<string> {
  if (res.action?.kind === "stop_consent") {
    // Belt-and-braces: o caminho normal já revogou acima; idempotente.
    await applyStopConsent(ctx, customers);
    return replyText;
  }
  if (res.action?.kind !== "quote_decision") {
    return replyText;
  }
  let applied = false;
  try {
    const result = await respondToQuote(
      ctx.prisma,
      {
        code: res.action.jobCode,
        decision: res.action.decision,
        phone4: msg.fromPhone.slice(-4),
        quoteId: res.action.quoteId,
      },
      ctx.notifyCtx ?? { prisma: ctx.prisma }
    );
    // Recusas vêm como resultado, não exceção: SUPERSEDED /
    // ALREADY_RESPONDED / PHONE_MISMATCH — confirmar o sucesso
    // nesses casos mentia ao cliente sobre uma decisão que ficou
    // por aplicar.
    applied = !result.error && result.jobExists;
  } catch {
    applied = false;
  }
  if (applied) {
    return res.actionSuccessText ?? replyText;
  }
  // Orçamento já respondido/substituído entretanto — a Cloud compôs
  // o texto para esse caso.
  return (
    res.actionFailureText ??
    "Esse orçamento já foi respondido ou substituído — a loja confirma contigo."
  );
}

/**
 * Gera a resposta para uma mensagem inbound — transporte puro: monta o
 * contexto, chama a Cloud (regras + IA) e executa as ações devolvidas.
 */
export async function composeReply(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  plainText = false,
  opts: {
    allowQuoteDecision?: boolean;
    /** Mensagem inbound já gravada na inbox — a IA lê o histórico da
     *  conversa excluindo-a (o userText vai à parte, §G.4). */
    inboxRecord?: { conversationId: string; messageId: string };
  } = {}
): Promise<BotReply> {
  const { customers, jobs } = await findCustomerJobs(ctx, msg.fromPhone);
  const customerName = customers[0]?.name ?? null;
  const text = (msg.text ?? "").trim();

  // PARAR/STOP — opt-out transversal, revogado localmente SEMPRE, mesmo
  // com a Cloud em baixo (obrigação legal). A confirmação é fixa aqui
  // pelo mesmo motivo; a Cloud tem a mesma regra para outros caminhos.
  if (isStopText(text)) {
    await applyStopConsent(ctx, customers);
    return {
      customerName,
      escalate: false,
      jobId: null,
      text: `Recebido — deixas de receber mensagens automáticas desta loja. Para voltar a receber, fala connosco — ${ctx.shopLabel}.`,
    };
  }

  const ai = ctx.ai;
  const escalateFallback = (): BotReply => ({
    customerName,
    escalate: true,
    jobId: jobs[0]?.id ?? null,
    text: `Recebemos a tua mensagem, ${customerName ?? ""} — a loja responde-te já.`,
  });

  // Sem configuração de canal/Cloud não há bot — enforcement: as regras
  // vivem na Cloud, não há fallback local.
  if (!ai) {
    return escalateFallback();
  }

  const toolCtx: BotToolCtx = {
    currency: ctx.currency,
    customerIds: customers.map((c) => c.id),
    log: ctx.log,
    portalApiUrl: ctx.portalApiUrl ?? null,
    portalEnabled: ctx.portalEnabled ?? false,
    prisma: ctx.prisma,
    timezone: ctx.timezone,
    shopCard: {
      botAvgRepairDaysAfterPart: ai.avgRepairDaysAfterPart,
      botInfoText: ai.botInfoText,
    },
  };
  // §G.4 — com a inbox ativa, o contexto vem das últimas 6 mensagens
  // gravadas (a atual excluída: vai como userText à parte).
  const history = opts.inboxRecord
    ? await getConversationHistory(
        ctx.prisma,
        opts.inboxRecord.conversationId,
        6,
        opts.inboxRecord.messageId
      ).catch(() => undefined)
    : undefined;

  const res = await askBotAi(toolCtx, ai, {
    channel: ai.channel,
    context: {
      aiEnabled: ai.enabled && ai.modules.includes(ai.module),
      allowQuoteDecision: opts.allowQuoteDecision,
      currency: ctx.currency,
      customers,
      jobs: serializeJobs(jobs),
      messageCreatedAt: msg.sentAt ?? msg.createdAt,
      messageType: msg.messageType,
      shopLabel: ctx.shopLabel,
      timezone: ctx.timezone,
    },
    history,
    phone: msg.fromPhone,
    userText: text,
  });

  // Cloud em baixo / resposta inválida → escala para staff (tradeoff
  // do enforcement — não há regras locais de reserva).
  if (!res) {
    return escalateFallback();
  }

  const executed = await executeCloudAction(
    ctx,
    res,
    msg,
    customers,
    res.reply
  );
  const replyText = plainText ? executed.replace(WA_BOLD_RE, "") : executed;
  return {
    customerName,
    escalate: res.escalate,
    // null explícito da Cloud = reparação ambígua — ligar a mais
    // recente abria a reparação errada ao staff. undefined (Cloud
    // antiga sem o campo) → compat com o comportamento anterior.
    jobId: res.jobId === undefined ? (jobs[0]?.id ?? null) : res.jobId,
    text: replyText,
  };
}

/** PARAR/STOP — desliga o consentimento em todos os clientes do número. */
async function applyStopConsent(
  ctx: BotReplyCtx,
  customers: { id: string }[]
): Promise<void> {
  for (const c of customers) {
    await ctx.prisma.customer.update({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: c.id },
    });
  }
}

/**
 * Revogação de consentimento fora do pipeline do bot — usada pelo
 * caminho §G.7 (inbox sem bot): um PARAR revoga sempre, mesmo quando o
 * módulo do canal está desligado e a mensagem só é gravada.
 */
export async function revokeConsentForPhone(
  prisma: DbClient,
  phone: string
): Promise<void> {
  const customers = await findCustomersByPhone(prisma, phone);
  for (const c of customers) {
    await prisma.customer.update({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: c.id },
    });
  }
}

/** Regista o inbound na caixa de entrada; com requireInboxPersist um
 *  registo falhado lança InboxPersistError (canal com fila não confirma
 *  a mensagem sem registo local — BUG #164 r8). */
async function recordInboundForChannel(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport
): Promise<Awaited<ReturnType<typeof recordInboundMessage>>> {
  if (!ctx.inbox?.enabled) {
    return null;
  }
  const inboxRecord = await recordInboundMessage(ctx.prisma, ctx.log, {
    at: new Date(msg.createdAt),
    channel: ctx.inbox.channel,
    externalId: msg.id,
    phone: msg.fromPhone,
    text: msg.text ?? `[${msg.messageType}]`,
  }).catch((err) => {
    ctx.log.warn({ err }, `${t.channelLabel}: inbox record falhou`);
    return null;
  });
  if (!inboxRecord && t.requireInboxPersist) {
    throw new InboxPersistError(`${t.channelLabel}: inbox record falhou`);
  }
  return inboxRecord;
}

/**
 * Pipeline de entrada partilhado pelos três canais (§2.1 do plano):
 * rate-limit → composeReply (regras → IA) → envio → escalada.
 * `sent=false` deixa o canal decidir o retry (a cloud só recebe ack
 * depois de envio confirmado); null = flood descartada sem resposta.
 */
/** Sinal interno: o registo na caixa de entrada falhou num canal com
 *  fila — o consumidor não confirma a mensagem e tenta de novo. */
export class InboxPersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxPersistError";
  }
}

export interface InboundTransport {
  /** Meta oficial fora da janela de 24h: SIM/NÃO não decide orçamentos. */
  allowQuoteDecision?: boolean;
  channelLabel: string;
  plainText?: boolean;
  /** Livro de ponto (Pro "ponto"): presente só nos canais que falam
   *  ponto — transport diz à Cloud por onde a marcação chegou e
   *  `interactive` envia mensagens interativas Meta (só oficial; a
   *  Evolution e o SMS não a suportam → o handler cai em texto). */
  ponto?: {
    interactive?: (interactive: Record<string, unknown>) => Promise<boolean>;
    transport: "sms" | "whatsapp_evolution" | "whatsapp_meta";
  };
  /** Evolution usa 10/h; oficial e SMS ficam no default de 20/h. */
  rateLimitPerHour?: number;
  /** Filas (Cloud): se o registo inbox falhar, lança InboxPersistError
   *  em vez de seguir sem registo — sem ele a mensagem perder-se-ia. */
  requireInboxPersist?: boolean;
  send: (text: string) => Promise<boolean>;
  /** Como `send` mas devolve o id da mensagem quando o canal o expõe
   *  (key.id da Evolution, wamid da Meta) — o livro de ponto usa-o nas
   *  perguntas de seguimento para a citação da resposta apontar para a
   *  mensagem real a que o trabalhador respondeu. Ausente quando o
   *  canal não devolve ids (SMS, envio suprimido). */
  sendWithId?: (
    text: string
  ) => Promise<{ messageId?: string; success: boolean }>;
  /** Envio suprimido (mensagem >23 h Meta, bot suspenso): o pipeline
   *  corre mas nada sai — a inbox grava o inbound, não o "envio". */
  silentSend?: boolean;
}

/** Livro de ponto (Pro "ponto") — PRIMEIRO passo de qualquer mensagem:
 *  telefone de funcionário com pontoEnabled nunca chega ao bot de
 *  clientes, à IA nem à caixa de entrada (as mensagens de ponto não são
 *  conversa de cliente). O handler responde pelo mesmo transporte e
 *  devolve true mesmo quando a mensagem não gerou comando — um
 *  funcionário nunca "cai" no pipeline de clientes. Falha do módulo não
 *  pode engolir a mensagem — cai no pipeline normal (melhor um alerta
 *  ao staff do que perder um PARAR). */
async function tryHandlePonto(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport
): Promise<boolean> {
  if (!t.ponto) {
    return false;
  }
  try {
    return await tryHandlePontoStaff(ctx, msg, t);
  } catch (err) {
    ctx.log.warn({ err }, `${t.channelLabel}: ponto handler falhou`);
    return false;
  }
}

/** O ponto reclamou a mensagem? Devolve a resposta "engolida" ou null
 *  para o pipeline normal seguir. Número dual-role (funcionário que
 *  também é cliente): o ponto engole PARAR/STOP como "comando
 *  desconhecido" e a revogação do composeReply nunca corria — os
 *  avisos automáticos continuavam autorizados. A revogação é
 *  transversal (§E.9): corre na mesma, idempotente com o
 *  applyStopConsent do pipeline normal. */
async function pontoClaimedReply(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport
): Promise<{ reply: BotReply; sent: boolean } | null> {
  if (!(await tryHandlePonto(ctx, msg, t))) {
    return null;
  }
  if (isStopText(msg.text ?? "")) {
    await revokeConsentForPhone(ctx.prisma, msg.fromPhone).catch((err) =>
      ctx.log.warn({ err }, `${t.channelLabel}: revogação PARAR falhou`)
    );
  }
  return {
    reply: { customerName: null, escalate: false, jobId: null, text: "" },
    sent: true,
  };
}

export async function handleInboundMessage(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport
): Promise<{ reply: BotReply; sent: boolean } | null> {
  const pontoReply = await pontoClaimedReply(ctx, msg, t);
  if (pontoReply) {
    return pontoReply;
  }
  // Opt-out legal: PARAR/STOP nunca morre no rate limiter — a revogação
  // do consentimento tem de correr mesmo quando o número esgotou a
  // janela horária (senão o cliente continua a receber avisos). A
  // confirmação, porém, conta para o limite anti-ban: acima do teto
  // horário a revogação fica gravada mas a resposta não sai.
  const isStop = STOP_WORDS.has((msg.text ?? "").trim().toLowerCase());
  // §G — caixa de entrada: grava TODAS as mensagens inbound antes de
  // qualquer decisão. A mensagem floodada por rate-limit também fica
  // registada — o limite é sobre respostas, não sobre o que a loja vê.
  const inboxRecord = await recordInboundForChannel(ctx, msg, t);
  const withinLimit = rateOk(msg.fromPhone, t.rateLimitPerHour);
  if (!(isStop || withinLimit)) {
    return null;
  }
  const out = await composeReply(ctx, msg, t.plainText, {
    allowQuoteDecision: t.allowQuoteDecision,
    inboxRecord: inboxRecord ?? undefined,
  });
  if (isStop && !withinLimit) {
    out.text = "";
  }
  let sent = true;
  if (out.text.length > 0) {
    try {
      sent = await t.send(out.text);
    } catch (err) {
      // Falha de transporte: sent=false deixa o poller re-tentar — e a
      // escalada ao staff em baixo tem de correr na mesma (um pedido de
      // ajuda que falha a enviar continua a ser um pedido de ajuda).
      sent = false;
      ctx.log.warn({ err }, `${t.channelLabel}-bot send threw`);
    }
    // §G — a resposta do bot também vai para a conversa (SENT/FAILED).
    // silentSend=true: envio suprimido, não há outbound a registar.
    if (ctx.inbox?.enabled && !t.silentSend) {
      await recordOutboundMessage(ctx.prisma, ctx.log, {
        channel: ctx.inbox.channel,
        deliveryStatus: sent ? "SENT" : "FAILED",
        handledBy: INBOX_HANDLED_BOT,
        phone: msg.fromPhone,
        text: out.text,
      }).catch((err) =>
        ctx.log.warn({ err }, `${t.channelLabel}: inbox outbound falhou`)
      );
    }
  }
  if (out.escalate) {
    if (inboxRecord) {
      await escalateConversation(ctx.prisma, inboxRecord.conversationId).catch(
        () => undefined
      );
    }
    await escalateToStaff(
      ctx,
      t.channelLabel,
      msg,
      out.customerName,
      out.jobId
    ).catch((err) =>
      ctx.log.warn({ err }, `${t.channelLabel}-bot escalate failed`)
    );
  }
  return { reply: out, sent };
}
