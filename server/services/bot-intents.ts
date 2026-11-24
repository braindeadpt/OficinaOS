import type { PrismaClient } from "@generated/client";
import { Role } from "@generated/client";
import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
} from "@shared/constants/job-statuses.js";
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
 * Intents de resposta automática partilhados pelos bots WhatsApp e SMS:
 * casa o remetente com um cliente (últimos 9 dígitos), compõe a resposta
 * (estado da reparação, orçamento, SIM/NÃO) e escala para staff quando
 * necessário. O envio é injectado por cada canal — whatsapp-bot.service
 * envia via Graph API, sms.service via gateway local na LAN.
 */

const STATUS_PT: Record<string, string> = {
  INTAKE: "Recebido",
  WAITING_FOR_PARTS: "À espera de peças",
  IN_REPAIR: "Em reparação",
  ON_HOLD: "Em espera",
  DONE: "Pronto para levantar",
  DELIVERED: "Entregue",
  RETURNED: "Devolvido",
  CANCELLED: "Cancelado",
};

const QUOTE_STATUS_PT: Record<string, string> = {
  SENT: "por responder",
  APPROVED: "aceite",
  REJECTED: "recusado",
  SUPERSEDED: "substituído",
};

const JOB_CODE_RE = /REP-\d{4}-\d{6}-[A-Z0-9]{3}/i;
const INTL_PREFIX_RE = /^00/;
const QUOTE_RE = /or[çc]amento|pre[çc]o|quanto(?!.{0,10}tempo)|custa/i;
// "quanto tempo falta" / "quando fica pronto" — perguntas de prazo têm
// resposta determinística própria, antes do ramo de orçamento ("quanto").
// "previsão"/"prazo" só contam quando NÃO modificados por uma palavra de
// preço ("previsão de preço" é orçamento, não prazo) — a exclusão exige o
// conector de/do/da para não atravessar fronteiras de frase ("Qual é a
// previsão? O preço já sei." é pergunta de prazo). "está"/"esta" soltos
// ficam de fora: "Quando está aberta a loja?" não é prazo de reparação.
const TIME_RE =
  /quanto tempo|quando.{0,25}(pronto|fica|entrega)|demora|falta.{0,15}pront|previs[aã]o(?!\s+(?:de|do|da|dos|das|para)\s+(?:(?:o|a|os|as|um|uma)\s+)?pre[çc]o)|prazo(?!\s+(?:de|do|da|dos|das|para)\s+(?:(?:o|a|os|as|um|uma)\s+)?(?:pre[çc]o|custo|pagamento))/i;
// A peça mencionada junto de chegada/previsão/entrega — pergunta pela peça
// em falta ("quando chega a peça?", "previsão de chegada da peça"), não
// pelo estado da reparação. Só a forma interrogada conta: uma menção à
// peça noutra frase ("Já paguei a peça.") não desvia o prazo da reparação.
const PART_ETA_RE =
  /(pe[çc]a|encomenda|componente).{0,25}(chega|chegada|previs|pront|entrega|demora)|(chega|chegada|previs[aã]o).{0,20}(pe[çc]a|encomenda|componente)/i;
// "ok" is deliberately absent — a bare "ok" in casual conversation
// must not legally accept a quote.
const YES_WORDS = new Set(["sim", "aceito", "confirmo", "aprovo"]);
const NO_WORDS = new Set(["não", "nao", "recuso", "rejeito"]);
// Opt-out transversal — desliga whatsappConsent no Customer e vale para
// todos os canais automáticos. Exact-match como SIM/NÃO: frases com
// "parar" embutido não tiram consentimento por acidente.
const STOP_WORDS = new Set(["parar", "stop"]);

/** Opt-out transversal — true para PARAR/STOP exatos (case-insensitive). */
export function isStopText(text: string): boolean {
  return STOP_WORDS.has(text.trim().toLowerCase());
}
const HUMAN_RE = /ajuda|humano|atendimento|operador|pessoa|urgente/i;
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

function eur(
  ctx: BotReplyCtx,
  amount: { toNumber(): number } | number
): string {
  const n = typeof amount === "number" ? amount : amount.toNumber();
  return new Intl.NumberFormat("pt-PT", {
    currency: ctx.currency,
    style: "currency",
  }).format(n);
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

function statusText(ctx: BotReplyCtx, job: ActiveJob): string {
  const device = `${job.device.brand.name} ${job.device.model}`;
  let text = `A tua reparação ${job.jobCode} (${device}) está: *${
    STATUS_PT[job.status] ?? job.status
  }*.`;
  if (job.estimatedDate) {
    text += ` Previsão: ${job.estimatedDate.toLocaleDateString("pt-PT", {
      timeZone: ctx.timezone ?? process.env.TZ ?? "Europe/Lisbon",
    })}.`;
  }
  // Registos de peças podem sobreviver à conclusão da reparação (o fluxo
  // não exige removê-los) — numa reparação pronta/entregue "Peças em
  // falta" seria contraditório, por isso a lista só aparece em estados
  // ativos.
  if (
    (job.partsWaiting?.length ?? 0) > 0 &&
    !(COMPLETED_STATUSES as string[]).includes(job.status)
  ) {
    text += ` Peças em falta: ${pendingPartsText(job)}.`;
  }
  const q = job.quotes[0];
  if (q?.status === "SENT") {
    text += ` Tens um orçamento de *${eur(
      ctx,
      q.amount
    )}* por responder — responde SIM para aceitar ou NÃO para recusar.`;
  } else {
    text += " Responde ORÇAMENTO para detalhes ou AJUDA para falar connosco.";
  }
  return text;
}

/** Resposta a «quando chega a peça» — a data esperada da peça em falta,
 *  não o estado da reparação. */
/** Partes em falta formatadas — cada uma com a data esperada ou
 *  "sem data prevista"; nunca esconde as que não têm data. */
function pendingPartsText(job: ActiveJob): string {
  // A previsão é um dia de calendário (meio-dia UTC no armazenamento) —
  // formatar em UTC mostra o mesmo dia em todos os fusos; formatar no
  // fuso da loja adiantava/atrasava um dia nos extremos (-12/+14).
  return (job.partsWaiting ?? [])
    .map((p) =>
      p.expectedAt
        ? `${p.partName} — chegada prevista: ${p.expectedAt.toLocaleDateString(
            "pt-PT",
            { timeZone: "UTC" }
          )}`
        : `${p.partName} — sem data prevista`
    )
    .join("; ");
}

/** Resposta a «quando chega a peça» — a data esperada da peça em falta,
 *  não o estado da reparação. */
function partEtaText(ctx: BotReplyCtx, job: ActiveJob): string {
  const device = `${job.device.brand.name} ${job.device.model}`;
  const tz = ctx.timezone ?? process.env.TZ ?? "Europe/Lisbon";
  let text = `Peças em falta para a tua reparação ${job.jobCode} (${device}): ${pendingPartsText(
    job
  )}.`;
  if (job.estimatedDate) {
    text += ` Previsão da reparação: ${job.estimatedDate.toLocaleDateString(
      "pt-PT",
      { timeZone: tz }
    )}.`;
  }
  return text;
}

function quoteText(ctx: BotReplyCtx, job: ActiveJob): string {
  const q = job.quotes[0];
  if (!q) {
    return `A reparação ${job.jobCode} ainda não tem orçamento — a loja envia em breve.`;
  }
  let text = `Orçamento ${job.jobCode} v${q.version}: *${eur(ctx, q.amount)}*`;
  if (q.note) {
    text += `\n${q.note}`;
  }
  text +=
    q.status === "SENT"
      ? "\nResponde SIM para aceitar ou NÃO para recusar."
      : `\nEstado: ${QUOTE_STATUS_PT[q.status] ?? q.status}.`;
  return text;
}

/** Retry de um SIM/NÃO já aplicado (a resposta anterior não chegou a
 * sair): o orçamento está decidido — devolve a confirmação da mesma
 * decisão em vez de "não tens orçamentos", que leria como se a decisão
 * se tivesse perdido. Decisão contrária → já respondido. */
function repeatOrEmpty(
  ctx: BotReplyCtx,
  decidedJob: ActiveJob | undefined,
  decision: "approve" | "reject"
): string {
  const last = decidedJob?.quotes[0];
  if (decision === "approve" && last?.status === "APPROVED") {
    return `Orçamento de ${eur(ctx, last.amount)} aceite ✅ Obrigado — a loja avança com a reparação ${decidedJob?.jobCode ?? ""}.`;
  }
  if (decision === "reject" && last?.status === "REJECTED") {
    return `Orçamento de ${eur(ctx, last.amount)} recusado. A loja entra em contacto contigo sobre ${decidedJob?.jobCode ?? ""}.`;
  }
  if (last?.status === "APPROVED" || last?.status === "REJECTED") {
    return "Esse orçamento já foi respondido ou substituído — a loja confirma contigo.";
  }
  return "Não tens orçamentos pendentes de resposta.";
}

// Tolerância para desfasamento de relógio Cloud↔DB: uma resposta só é
// "anterior ao orçamento" quando a diferença ultrapassa este intervalo.
const STALE_DECISION_GRACE_MS = 60_000;

/** Aplica SIM/NÃO via respondToQuote — o mesmo serviço do portal/LAN.
 * `stale` = a resposta chegou antes deste orçamento sair (fila Cloud):
 * refere-se a outro, nunca se aplica ao mais recente por engano. */
async function answerQuote(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  jobs: ActiveJob[],
  direct: ActiveJob | undefined,
  decision: "approve" | "reject"
): Promise<{ stale: boolean; text: string }> {
  const pending = jobs.filter((j) => j.quotes[0]?.status === "SENT");
  let target: ActiveJob | undefined;
  if (direct?.quotes[0]?.status === "SENT") {
    target = direct;
  } else if (pending.length === 1) {
    target = pending[0];
  }
  if (!target) {
    return {
      stale: false,
      text: repeatOrEmpty(
        ctx,
        direct ?? (jobs.length === 1 ? jobs[0] : undefined),
        decision
      ),
    };
  }
  const quote = target.quotes[0];
  if (!quote) {
    return { stale: false, text: "Não tens orçamentos pendentes de resposta." };
  }
  const replyAt = Date.parse(msg.createdAt);
  if (
    Number.isFinite(replyAt) &&
    quote.sentAt &&
    replyAt < quote.sentAt.getTime() - STALE_DECISION_GRACE_MS
  ) {
    return { stale: true, text: "" };
  }
  const result = await respondToQuote(
    ctx.prisma,
    {
      code: target.jobCode,
      decision,
      phone4: msg.fromPhone.slice(-4),
      quoteId: quote.id,
    },
    ctx.notifyCtx ?? { prisma: ctx.prisma }
  );
  if (result.error) {
    return {
      stale: false,
      text: "Esse orçamento já foi respondido ou substituído — a loja confirma contigo.",
    };
  }
  return {
    stale: false,
    text:
      decision === "approve"
        ? `Orçamento de ${eur(ctx, quote.amount)} aceite ✅ Obrigado — a loja avança com a reparação ${target.jobCode}.`
        : `Orçamento de ${eur(ctx, quote.amount)} recusado. A loja entra em contacto contigo sobre ${target.jobCode}.`,
  };
}

export interface BotReply {
  customerName: string | null;
  escalate: boolean;
  jobId: string | null;
  text: string;
}

/** SIM/NÃO — decisão vinculativa de orçamento, sempre determinístico. */
async function decideQuoteIntent(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  jobs: ActiveJob[],
  direct: ActiveJob | undefined,
  customerName: string | null,
  targetJobId: string | null,
  decision: "approve" | "reject",
  opts: { allowQuoteDecision?: boolean }
): Promise<BotReply> {
  if (opts.allowQuoteDecision === false) {
    return {
      customerName,
      // A decisão não se aplica, mas a equipa tem de a ver — um SIM
      // fora da janela sem registo deixava o cliente à espera de uma
      // resposta que nunca chega. Sem jobId: com várias reparações
      // ativas não se sabe a que orçamento o SIM/NÃO se refere e
      // ligar a mais recente abria a reparação errada.
      escalate: true,
      jobId: null,
      text: "",
    };
  }
  const out = await answerQuote(ctx, msg, jobs, direct, decision);
  if (out.stale) {
    // Resposta mais antiga que o orçamento pendente — refere-se a
    // outro. A equipa vê-a (escalada) mas a decisão não se aplica.
    return { customerName, escalate: true, jobId: null, text: "" };
  }
  return {
    customerName,
    escalate: false,
    jobId: targetJobId,
    text: out.text,
  };
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
  const last9 = senderDigits.slice(-9);
  const last4 = senderDigits.slice(-4);
  if ((isPtSender && last9.length < 9) || last4.length < 4) {
    return [];
  }
  const candidates = await prisma.customer.findMany({
    where: { phone: { endsWith: last4 } },
    select: { id: true, name: true, phone: true },
  });
  return candidates
    .filter((c) => {
      const cd = c.phone.replace(DIGITS_RE, "").replace(INTL_PREFIX_RE, "");
      if (cd === senderDigits) {
        return true;
      }
      // Sufixo só vale entre números PT — uma ficha estrangeira com os
      // mesmos 9 dígitos finais não é o mesmo cliente.
      return isPtSender && ptLike(cd) && cd.slice(-9) === last9;
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

function listJobsText(customerName: string | null, jobs: ActiveJob[]): string {
  return `Olá ${customerName}! Tens ${jobs.length} reparações em curso:\n${jobs
    .map((j) => `• ${j.jobCode} — ${STATUS_PT[j.status] ?? j.status}`)
    .join("\n")}\nResponde com o código para detalhes.`;
}

/**
 * Gera a resposta para uma mensagem inbound. `plainText` remove os marcadores
 * de negrito do WhatsApp — o SMS mostraria os asteriscos literalmente.
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
  if (customers.length === 0) {
    return {
      customerName: null,
      escalate: true,
      jobId: null,
      text: `Olá! Não encontrei reparações associadas a este número. Se és cliente, confirma connosco — ${ctx.shopLabel}.`,
    };
  }

  const customerName = customers[0]?.name ?? null;
  const text = (msg.text ?? "").trim();
  const lower = text.toLowerCase();
  const codeMatch = text.match(JOB_CODE_RE);
  const direct = codeMatch
    ? jobs.find((j) => j.jobCode.toUpperCase() === codeMatch[0].toUpperCase())
    : undefined;
  const targetJobId = direct?.id ?? jobs[0]?.id ?? null;

  // Não-texto ou pedido explícito de humano → escala para staff.
  if (msg.messageType !== "text" || HUMAN_RE.test(lower)) {
    return {
      customerName,
      escalate: true,
      jobId: targetJobId,
      text: `Recebemos a tua mensagem, ${customerName ?? ""} — a loja responde-te já.`,
    };
  }

  // PARAR/STOP — opt-out transversal, sempre antes da IA (§E.9).
  if (STOP_WORDS.has(lower)) {
    await applyStopConsent(ctx, customers);
    return {
      customerName,
      escalate: false,
      jobId: null,
      text: `Recebido — deixas de receber mensagens automáticas desta loja. Para voltar a receber, fala connosco — ${ctx.shopLabel}.`,
    };
  }

  // SIM/NÃO — decisão vinculativa de orçamento: SEMPRE determinístico.
  // Em mensagens velhas (>23h na Meta oficial) a decisão não se aplica —
  // o cliente pode estar a responder a outro orçamento; nunca decidir
  // sem poder confirmar na hora.
  if (YES_WORDS.has(lower) || NO_WORDS.has(lower)) {
    return decideQuoteIntent(
      ctx,
      msg,
      jobs,
      direct,
      customerName,
      targetJobId,
      YES_WORDS.has(lower) ? "approve" : "reject",
      opts
    );
  }

  // IA (Pro, atrás de flag): só texto livre — mensagens com código REP ou
  // pedido de orçamento ficam nas regras determinísticas. Falha/sem módulo
  // → cai nas regras em vez de ficar em silêncio.
  const aiReply = await tryBotAiReply(ctx, msg, {
    codeMatch: !!codeMatch,
    customerIds: customers.map((c) => c.id),
    inboxRecord: opts.inboxRecord,
    lower,
    text,
  });
  if (aiReply) {
    const reply: BotReply = {
      customerName,
      escalate: aiReply.escalate,
      jobId: targetJobId,
      text: aiReply.text,
    };
    if (plainText) {
      reply.text = reply.text.replace(WA_BOLD_RE, "");
    }
    return reply;
  }

  if (jobs.length === 0) {
    return {
      customerName,
      escalate: false,
      jobId: null,
      text: `Olá ${customerName}! Não tens reparações em curso neste momento — ${ctx.shopLabel}.`,
    };
  }

  const reply = routeIntent(ctx, customerName, jobs, direct, lower);
  if (plainText) {
    reply.text = reply.text.replace(WA_BOLD_RE, "");
  }
  return reply;
}

/** PARAR/STOP — desliga o consentimento em todos os clientes do número. */
async function applyStopConsent(
  ctx: BotReplyCtx,
  customers: { id: string }[]
): Promise<void> {
  for (const c of customers) {
    await ctx.prisma.customer.update({
      data: { whatsappConsent: false },
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
      data: { whatsappConsent: false },
      where: { id: c.id },
    });
  }
}

/** Pergunta à IA quando a flag, o entitlement e o formato da mensagem deixam. */
async function tryBotAiReply(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  input: {
    codeMatch: boolean;
    customerIds: string[];
    inboxRecord?: { conversationId: string; messageId: string };
    lower: string;
    text: string;
  }
): Promise<{ escalate: boolean; text: string } | null> {
  const ai = ctx.ai;
  if (
    !ai?.enabled ||
    input.text.length === 0 ||
    QUOTE_RE.test(input.lower) ||
    TIME_RE.test(input.lower) ||
    // «quando chega a peça?» não tem «previsão»/«prazo» — sem este
    // termo a pergunta ia para a IA em vez da resposta determinística
    // com a data registada da peça.
    PART_ETA_RE.test(input.lower) ||
    input.codeMatch ||
    !ai.modules.includes(ai.module)
  ) {
    return null;
  }
  const toolCtx: BotToolCtx = {
    currency: ctx.currency,
    customerIds: input.customerIds,
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
  const history = input.inboxRecord
    ? await getConversationHistory(
        ctx.prisma,
        input.inboxRecord.conversationId,
        6,
        input.inboxRecord.messageId
      ).catch(() => undefined)
    : undefined;
  const res = await askBotAi(toolCtx, ai, {
    channel: ai.channel,
    history,
    phone: msg.fromPhone,
    userText: input.text,
  });
  return res ? { escalate: res.escalate, text: res.reply } : null;
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

export async function handleInboundMessage(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport
): Promise<{ reply: BotReply; sent: boolean } | null> {
  if (await tryHandlePonto(ctx, msg, t)) {
    return {
      reply: { customerName: null, escalate: false, jobId: null, text: "" },
      sent: true,
    };
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

/** Decide o intent e compõe a resposta quando há ≥1 job ativo. */
function routeIntent(
  ctx: BotReplyCtx,
  customerName: string | null,
  jobs: ActiveJob[],
  direct: ActiveJob | undefined,
  lower: string
): BotReply {
  if (TIME_RE.test(lower) || PART_ETA_RE.test(lower)) {
    const target = direct ?? (jobs.length === 1 ? jobs[0] : undefined);
    if (!target) {
      return {
        customerName,
        escalate: false,
        jobId: null,
        text: `Tens ${jobs.length} reparações em curso: ${jobs
          .map((j) => j.jobCode)
          .join(", ")}. Responde com o código para veres a previsão.`,
      };
    }
    // «Chegada da peça» pergunta pela peça em falta — se há peças
    // registadas, responde com a data esperada da peça (não o estado).
    // Em reparações concluídas os registos podem ficar por apagar —
    // cai no estado («Pronto para levantar») como no statusText.
    if (
      PART_ETA_RE.test(lower) &&
      (target.partsWaiting?.length ?? 0) > 0 &&
      !(COMPLETED_STATUSES as string[]).includes(target.status)
    ) {
      return {
        customerName,
        escalate: false,
        jobId: target.id,
        text: partEtaText(ctx, target),
      };
    }
    return {
      customerName,
      escalate: false,
      jobId: target.id,
      text: statusText(ctx, target),
    };
  }

  if (QUOTE_RE.test(lower)) {
    const target = direct ?? (jobs.length === 1 ? jobs[0] : undefined);
    if (!target) {
      return {
        customerName,
        escalate: false,
        jobId: null,
        text: `Tens ${jobs.length} reparações em curso: ${jobs
          .map((j) => j.jobCode)
          .join(", ")}. Responde com o código para veres o orçamento.`,
      };
    }
    return {
      customerName,
      escalate: false,
      jobId: target.id,
      text: quoteText(ctx, target),
    };
  }

  if (direct) {
    return {
      customerName,
      escalate: false,
      jobId: direct.id,
      text: statusText(ctx, direct),
    };
  }

  if (jobs.length === 1) {
    const job = jobs[0];
    return {
      customerName,
      escalate: false,
      jobId: job.id,
      text: statusText(ctx, job),
    };
  }

  return {
    customerName,
    escalate: false,
    jobId: null,
    text: listJobsText(customerName, jobs),
  };
}
