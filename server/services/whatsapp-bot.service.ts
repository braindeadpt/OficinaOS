import type { PrismaClient } from "@generated/client";
import { Role } from "@generated/client";
import { ACTIVE_STATUSES } from "@shared/constants/job-statuses.js";
import type { FastifyBaseLogger } from "fastify";
import {
  createManyAndReturnInAppNotifications,
  findManyUsers,
} from "../repositories/notification.repository.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { respondToQuote } from "./job-quote.service.js";
import { decryptWhatsAppConfig, sendWhatsApp } from "./notification-sender.js";

/**
 * WhatsApp bot (módulo "whatsapp-bot"): a cloud fila mensagens inbound
 * que chegam pelo webhook da Meta; a app faz poll, casa o remetente com
 * um cliente pelo número de telefone e responde com dados da ficha
 * (estado, orçamento, aceitação por SIM/NÃO). Responder a inbound é
 * comunicação de serviço na janela de 24h — whatsappConsent só é
 * exigido para notificações iniciadas pela loja.
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
const YES_WORDS = new Set(["sim", "aceito", "ok", "confirmo", "aprovo"]);
const NO_WORDS = new Set(["não", "nao", "recuso", "rejeito"]);
const HUMAN_RE = /ajuda|humano|atendimento|operador|pessoa|urgente/i;
const DIGITS_RE = /\D/g;

const MAX_SEND_ATTEMPTS = 3;
const MSG_LIMIT_PER_HOUR = 20;

// In-memory flood limiter + send-attempt counter — reset on restart,
// which is fine: worst case a flood source gets one extra window.
const rateBuckets = new Map<string, { n: number; resetAt: number }>();
const sendAttempts = new Map<string, number>();

interface InboundMessage {
  createdAt: string;
  fromPhone: string;
  id: string;
  messageType: string;
  text: string | null;
}

interface BotCtx {
  apiUrl: string;
  currency: string;
  log: FastifyBaseLogger;
  notifyCtx: NotifyContext | undefined;
  prisma: PrismaClient;
  shopLabel: string;
  token: string;
  waConfig: NonNullable<ReturnType<typeof decryptWhatsAppConfig>>;
}

function rateOk(phone: string): boolean {
  const now = Date.now();
  let b = rateBuckets.get(phone);
  if (!b || b.resetAt < now) {
    b = { n: 0, resetAt: now + 3_600_000 };
    rateBuckets.set(phone, b);
  }
  return ++b.n <= MSG_LIMIT_PER_HOUR;
}

function eur(ctx: BotCtx, amount: { toNumber(): number } | number): string {
  const n = typeof amount === "number" ? amount : amount.toNumber();
  return new Intl.NumberFormat("pt-PT", {
    currency: ctx.currency,
    style: "currency",
  }).format(n);
}

async function send(ctx: BotCtx, to: string, text: string): Promise<boolean> {
  const res = await sendWhatsApp(ctx.waConfig, `+${to}`, text);
  if (!res.success) {
    ctx.log.warn({ err: res.error, to: `+${to}` }, "whatsapp-bot send failed");
  }
  return res.success;
}

/** Notifica staff in-app e avisa o cliente que um humano responde. */
async function escalateToStaff(
  ctx: BotCtx,
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
      message: `WhatsApp de ${who}: "${snippet}"`,
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

function statusText(ctx: BotCtx, job: ActiveJob): string {
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

function quoteText(ctx: BotCtx, job: ActiveJob): string {
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
  ctx: BotCtx,
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

interface BotReply {
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
  ctx: BotCtx,
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

/** Gera a resposta para uma mensagem inbound. */
async function composeReply(
  ctx: BotCtx,
  msg: InboundMessage
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

  // Não-texto ou pedido explícito de humano → escala para staff.
  if (msg.messageType !== "text" || HUMAN_RE.test(lower)) {
    return {
      customerName,
      escalate: true,
      jobId: direct?.id ?? jobs[0]?.id ?? null,
      text: `Recebemos a tua mensagem, ${customerName ?? ""} — a loja responde-te já.`,
    };
  }

  if (jobs.length === 0) {
    return {
      customerName,
      escalate: false,
      jobId: null,
      text: `Olá ${customerName}! Não tens reparações em curso neste momento — ${ctx.shopLabel}.`,
    };
  }

  return routeIntent(ctx, msg, customerName, jobs, direct, lower);
}

/** Decide o intent e compõe a resposta quando há ≥1 job ativo. */
async function routeIntent(
  ctx: BotCtx,
  msg: InboundMessage,
  customerName: string | null,
  jobs: ActiveJob[],
  direct: ActiveJob | undefined,
  lower: string
): Promise<BotReply> {
  if (YES_WORDS.has(lower) || NO_WORDS.has(lower)) {
    const reply = await answerQuote(
      ctx,
      msg,
      jobs,
      direct,
      YES_WORDS.has(lower) ? "approve" : "reject"
    );
    return {
      customerName,
      escalate: false,
      jobId: (direct ?? jobs[0])?.id ?? null,
      text: reply,
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
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });

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
      await escalateToStaff(ctx, msg, out.customerName, out.jobId).catch(
        (err) => ctx.log.warn({ err }, "whatsapp-bot escalate failed")
      );
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
