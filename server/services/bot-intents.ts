import type { PrismaClient } from "@generated/client";
import { Role } from "@generated/client";
import { ACTIVE_STATUSES } from "@shared/constants/job-statuses.js";
import type { FastifyBaseLogger } from "fastify";
import {
  createManyAndReturnInAppNotifications,
  findManyUsers,
} from "../repositories/notification.repository.js";
import { askBotAi } from "./bot-ai.js";
import type { BotToolCtx } from "./bot-tools.js";
import type { NotifyContext } from "./job.service.js";
import { respondToQuote } from "./job-quote.service.js";

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
const QUOTE_RE = /or[çc]amento|pre[çc]o|quanto|custa/i;
// "ok" is deliberately absent — a bare "ok" in casual conversation
// must not legally accept a quote.
const YES_WORDS = new Set(["sim", "aceito", "confirmo", "aprovo"]);
const NO_WORDS = new Set(["não", "nao", "recuso", "rejeito"]);
// Opt-out transversal — desliga whatsappConsent no Customer e vale para
// todos os canais automáticos. Exact-match como SIM/NÃO: frases com
// "parar" embutido não tiram consentimento por acidente.
const STOP_WORDS = new Set(["parar", "stop"]);
const HUMAN_RE = /ajuda|humano|atendimento|operador|pessoa|urgente/i;
const DIGITS_RE = /\D/g;
const WA_BOLD_RE = /\*/g;

const MSG_LIMIT_PER_HOUR = 20;

// In-memory flood limiter — reset on restart, which is fine: worst case
// a flood source gets one extra window. Shared by both channels.
const rateBuckets = new Map<string, { n: number; resetAt: number }>();

export interface InboundMessage {
  createdAt: string;
  fromPhone: string;
  id: string;
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
  log: FastifyBaseLogger;
  notifyCtx: NotifyContext | undefined;
  /** Cloud API base para o link do portal na vistaCliente (null → sem link). */
  portalApiUrl?: string | null;
  /** true quando o módulo "portal" está ativo nos entitlements. */
  portalEnabled?: boolean;
  prisma: PrismaClient;
  shopLabel: string;
}

export function rateOk(phone: string, limit = MSG_LIMIT_PER_HOUR): boolean {
  const now = Date.now();
  // Normalize — WhatsApp delivers "351912…" while sms-gate may send
  // "+351912…" or "0912…"; the same sender must share one bucket.
  const key = phone.replace(DIGITS_RE, "").slice(-9);
  let b = rateBuckets.get(key);
  if (!b || b.resetAt < now) {
    b = { n: 0, resetAt: now + 3_600_000 };
    rateBuckets.set(key, b);
  }
  return ++b.n <= limit;
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
  const who = customerName ?? `+${msg.fromPhone}`;
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
  quotes: {
    id: string;
    version: number;
    amount: { toNumber(): number };
    note: string | null;
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
    text += ` Previsão: ${job.estimatedDate.toLocaleDateString("pt-PT")}.`;
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

/** Aplica SIM/NÃO via respondToQuote — o mesmo serviço do portal/LAN. */
async function answerQuote(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  jobs: ActiveJob[],
  direct: ActiveJob | undefined,
  decision: "approve" | "reject"
): Promise<string> {
  const pending = jobs.filter((j) => j.quotes[0]?.status === "SENT");
  let target: ActiveJob | undefined;
  if (direct?.quotes[0]?.status === "SENT") {
    target = direct;
  } else if (pending.length === 1) {
    target = pending[0];
  }
  if (!target) {
    return "Não tens orçamentos pendentes de resposta.";
  }
  const quote = target.quotes[0];
  if (!quote) {
    return "Não tens orçamentos pendentes de resposta.";
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
    return "Esse orçamento já foi respondido ou substituído — a loja confirma contigo.";
  }
  return decision === "approve"
    ? `Orçamento de ${eur(ctx, quote.amount)} aceite ✅ Obrigado — a loja avança com a reparação ${target.jobCode}.`
    : `Orçamento de ${eur(ctx, quote.amount)} recusado. A loja entra em contacto contigo sobre ${target.jobCode}.`;
}

export interface BotReply {
  customerName: string | null;
  escalate: boolean;
  jobId: string | null;
  text: string;
}

interface CustomerMatch {
  customers: { id: string; name: string }[];
  jobs: ActiveJob[];
}

/** Casa o remetente com clientes (últimos 9 dígitos) e traz jobs ativos. */
async function findCustomerJobs(
  ctx: BotReplyCtx,
  fromPhone: string
): Promise<CustomerMatch> {
  const last9 = fromPhone.slice(-9);
  const last4 = fromPhone.slice(-4);
  if (last9.length < 9 || last4.length < 4) {
    return { customers: [], jobs: [] };
  }
  const candidates = await ctx.prisma.customer.findMany({
    where: { phone: { endsWith: last4 } },
    select: { id: true, name: true, phone: true },
  });
  const customers = candidates.filter(
    (c) => c.phone.replace(DIGITS_RE, "").slice(-9) === last9
  );
  if (customers.length === 0) {
    return { customers, jobs: [] };
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
      quotes: {
        orderBy: { version: "desc" as const },
        take: 1,
        select: {
          id: true,
          version: true,
          amount: true,
          note: true,
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
  plainText = false
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
  if (YES_WORDS.has(lower) || NO_WORDS.has(lower)) {
    const reply = await answerQuote(
      ctx,
      msg,
      jobs,
      direct,
      YES_WORDS.has(lower) ? "approve" : "reject"
    );
    return { customerName, escalate: false, jobId: targetJobId, text: reply };
  }

  // IA (Pro, atrás de flag): só texto livre — mensagens com código REP ou
  // pedido de orçamento ficam nas regras determinísticas. Falha/sem módulo
  // → cai nas regras em vez de ficar em silêncio.
  const aiReply = await tryBotAiReply(ctx, msg, {
    codeMatch: !!codeMatch,
    customerIds: customers.map((c) => c.id),
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

/** Pergunta à IA quando a flag, o entitlement e o formato da mensagem deixam. */
async function tryBotAiReply(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  input: {
    codeMatch: boolean;
    customerIds: string[];
    lower: string;
    text: string;
  }
): Promise<{ escalate: boolean; text: string } | null> {
  const ai = ctx.ai;
  if (
    !ai?.enabled ||
    input.text.length === 0 ||
    QUOTE_RE.test(input.lower) ||
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
    shopCard: {
      botAvgRepairDaysAfterPart: ai.avgRepairDaysAfterPart,
      botInfoText: ai.botInfoText,
    },
  };
  const res = await askBotAi(toolCtx, ai, {
    channel: ai.channel,
    phone: msg.fromPhone,
    userText: input.text,
  });
  return res ? { escalate: res.escalate, text: res.reply } : null;
}

/**
 * Pipeline de entrada partilhado pelos três canais (§2.1 do plano):
 * rate-limit → composeReply (regras → IA) → envio → escalada.
 * `sent=false` deixa o canal decidir o retry (a cloud só recebe ack
 * depois de envio confirmado); null = flood descartada sem resposta.
 */
export interface InboundTransport {
  channelLabel: string;
  plainText?: boolean;
  /** Evolution usa 10/h; oficial e SMS ficam no default de 20/h. */
  rateLimitPerHour?: number;
  send: (text: string) => Promise<boolean>;
}

export async function handleInboundMessage(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport
): Promise<{ reply: BotReply; sent: boolean } | null> {
  if (!rateOk(msg.fromPhone, t.rateLimitPerHour)) {
    return null;
  }
  const out = await composeReply(ctx, msg, t.plainText);
  const sent = out.text.length > 0 ? await t.send(out.text) : true;
  if (out.escalate) {
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
