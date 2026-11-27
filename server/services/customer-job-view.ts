import type { Prisma, PrismaClient } from "@generated/client";
import { computeJobBalance } from "./payment.service.js";
import { portalUrl } from "./portal.service.js";

/**
 * vistaCliente() — a ÚNICA ficha allowlisted que expõe dados de uma
 * reparação ao cliente. Portal, WhatsApp, SMS e o bot de IA leem daqui —
 * nunca de outra query. Tudo o que não está nesta lista NÃO sai:
 * IMEI, PIN/código de desbloqueio, fornecedor, custos internos,
 * holdReason, notas privadas, dados de outros clientes, etc.
 *
 * Teste de snapshot em __tests__/customer-job-view.test.ts bloqueia a
 * lista de chaves — qualquer campo novo passa por revisão explícita.
 */

export const JOB_STATUS_I18N: Record<string, Record<string, string>> = {
  pt: {
    INTAKE: "Recebido",
    WAITING_FOR_PARTS: "À espera de peças",
    IN_REPAIR: "Em reparação",
    ON_HOLD: "Em pausa",
    DONE: "Pronto para levantar",
    DELIVERED: "Entregue",
    RETURNED: "Devolvido",
    CANCELLED: "Cancelado",
  },
  en: {
    INTAKE: "Received",
    WAITING_FOR_PARTS: "Waiting for parts",
    IN_REPAIR: "In repair",
    ON_HOLD: "On hold",
    DONE: "Ready for pickup",
    DELIVERED: "Delivered",
    RETURNED: "Returned",
    CANCELLED: "Cancelled",
  },
  es: {
    INTAKE: "Recibido",
    WAITING_FOR_PARTS: "Esperando piezas",
    IN_REPAIR: "En reparación",
    ON_HOLD: "En pausa",
    DONE: "Listo para recoger",
    DELIVERED: "Entregado",
    RETURNED: "Devuelto",
    CANCELLED: "Cancelado",
  },
  fr: {
    INTAKE: "Reçu",
    WAITING_FOR_PARTS: "En attente de pièces",
    IN_REPAIR: "En réparation",
    ON_HOLD: "En pause",
    DONE: "Prêt à récupérer",
    DELIVERED: "Livré",
    RETURNED: "Retourné",
    CANCELLED: "Annulé",
  },
};

// Alias de compatibilidade — consumidores antigos leem a tabela PT direta.
export const JOB_STATUS_PT: Record<string, string> = JOB_STATUS_I18N.pt;

const QUOTE_STATUS_I18N: Record<string, Record<string, string>> = {
  pt: {
    SENT: "por responder",
    APPROVED: "aceite",
    REJECTED: "recusado",
    SUPERSEDED: "substituído",
  },
  en: {
    SENT: "pending response",
    APPROVED: "accepted",
    REJECTED: "rejected",
    SUPERSEDED: "superseded",
  },
  es: {
    SENT: "pendiente de respuesta",
    APPROVED: "aceptado",
    REJECTED: "rechazado",
    SUPERSEDED: "sustituido",
  },
  fr: {
    SENT: "en attente de réponse",
    APPROVED: "accepté",
    REJECTED: "refusé",
    SUPERSEDED: "remplacé",
  },
};

/** Língua documental resolvida da vista — pt quando o chamador não diz. */
function viewLocale(ctx: CustomerViewCtx): string {
  const lang = (ctx.locale ?? "pt").split("-")[0].toLowerCase();
  return JOB_STATUS_I18N[lang] ? lang : "pt";
}

/** Locale Intl completo para a língua documental (formatação de valores). */
const INTL_LOCALE: Record<string, string> = {
  pt: "pt-PT",
  en: "en-GB",
  es: "es-ES",
  fr: "fr-FR",
};

const MS_PER_DAY = 86_400_000;

export const CUSTOMER_JOB_VIEW_SELECT = {
  accessCode: true,
  color: true,
  depositAmount: true,
  device: {
    select: { brand: { select: { name: true } }, model: true },
  },
  estimatedCost: true,
  estimatedDate: true,
  externalRepairs: {
    orderBy: { createdAt: "desc" as const },
    select: { expectedReturnAt: true, status: true },
    take: 1,
  },
  hasLoanerDevice: true,
  jobCode: true,
  loanerReturnedAt: true,
  notes: {
    orderBy: { createdAt: "asc" as const },
    select: { content: true },
    where: { isCustomerVisible: true },
  },
  partsUsed: { select: { totalCost: true } },
  partsWaiting: {
    orderBy: { createdAt: "asc" as const },
    select: { expectedAt: true, partName: true },
  },
  payments: { select: { amount: true } },
  portalPublishedAt: true,
  repairs: { select: { price: true } },
  quotes: {
    orderBy: { version: "desc" as const },
    select: {
      amount: true,
      id: true,
      note: true,
      sentAt: true,
      status: true,
      version: true,
    },
    take: 1,
  },
  status: true,
  warrantyForJobId: true,
} satisfies Prisma.JobSelect;

export type CustomerJobViewRow = Prisma.JobGetPayload<{
  select: typeof CUSTOMER_JOB_VIEW_SELECT;
}>;

export interface CustomerJobView {
  aparelho: string;
  codigo: string;
  dataPrevista: string | null;
  diasAtraso: number;
  emPausa: boolean;
  emprestimo: boolean;
  estado: string;
  garantia: boolean;
  linkPortal: string | null;
  notasVisiveis: string[];
  orcamento: {
    enviadoEm: string | null;
    estado: string;
    nota: string | null;
    validade: string | null;
    valor: string;
    versao: number;
  } | null;
  pecasEmEspera: { chegadaPrevista: string | null; nome: string }[];
  reparacaoExterna: { regressoPrevisto: string | null } | null;
  valores: {
    emFalta: string | null;
    estimado: string | null;
    pago: string;
    sinal: string | null;
  };
}

export interface CustomerViewCtx {
  currency: string;
  /** Língua documental da projeção (pt/en/es/fr) — derivada do país da loja
   *  nos canais sem browser (WhatsApp/SMS/bot). O tracking público não lê
   *  desta projeção: o portal publica um instantâneo locale-neutro que a
   *  Cloud traduz no lado dela. Omissa = pt, o comportamento de sempre. */
  locale?: string;
  /** Cloud API base used to build the public portal link (null → no link). */
  portalApiUrl: string | null;
  /** Active module ids — portal link only when "portal" is entitled. */
  portalEnabled: boolean;
  /** IANA timezone da loja — datas "dia cheio" renderizam-se aqui, não em
   *  UTC (meia-noite local vira o dia anterior em UTC no verão). */
  timezone?: string;
}

function eur(ctx: CustomerViewCtx, n: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[viewLocale(ctx)] ?? "pt-PT", {
    currency: ctx.currency,
    style: "currency",
  }).format(n);
}

/** YYYY-MM-DD no fuso da loja (não no fuso UTC do servidor). */
function isoDate(d: Date | null, tz: string): string | null {
  if (!d) {
    return null;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** Constrói a ficha do cliente a partir de um Job já carregado com CUSTOMER_JOB_VIEW_SELECT. */
export function vistaCliente(
  job: CustomerJobViewRow,
  ctx: CustomerViewCtx
): CustomerJobView {
  const aparelho = `${job.device.brand.name} ${job.device.model}${
    job.color ? ` ${job.color}` : ""
  }`;
  const lang = viewLocale(ctx);
  const estado = JOB_STATUS_I18N[lang][job.status] ?? job.status;
  const emPausa = job.status === "ON_HOLD";
  const diasAtraso =
    job.estimatedDate &&
    job.status !== "DONE" &&
    job.status !== "DELIVERED" &&
    job.status !== "RETURNED" &&
    job.status !== "CANCELLED" &&
    job.estimatedDate.getTime() < Date.now()
      ? Math.floor((Date.now() - job.estimatedDate.getTime()) / MS_PER_DAY)
      : 0;

  const tz = ctx.timezone ?? "Europe/Lisbon";
  const quote = job.quotes[0];
  const pago = job.payments.reduce((acc, p) => acc + p.amount.toNumber(), 0);
  const estimado = job.estimatedCost?.toNumber() ?? null;
  // Em falta = o saldo real da reparação (peças+serviços − sinal − pagos),
  // não "estimado − pago": cobranças reais e o sinal mudam o valor.
  const { balanceDue } = computeJobBalance(job);
  const emFalta =
    job.partsUsed.length + job.repairs.length === 0 ? null : balanceDue;

  const openExternal = job.externalRepairs.find((r) => r.status === "SENT");

  return {
    aparelho,
    codigo: job.jobCode,
    dataPrevista: isoDate(job.estimatedDate, tz),
    diasAtraso,
    emPausa,
    emprestimo: job.hasLoanerDevice && job.loanerReturnedAt === null,
    estado,
    garantia: job.warrantyForJobId !== null,
    linkPortal:
      ctx.portalEnabled && job.portalPublishedAt && ctx.portalApiUrl
        ? portalUrl(ctx.portalApiUrl, job.accessCode)
        : null,
    notasVisiveis: job.notes.map((n) => n.content),
    orcamento: quote
      ? {
          enviadoEm: quote.sentAt?.toISOString() ?? null,
          estado: QUOTE_STATUS_I18N[lang][quote.status] ?? quote.status,
          nota: quote.note,
          validade: null,
          valor: eur(ctx, quote.amount.toNumber()),
          versao: quote.version,
        }
      : null,
    pecasEmEspera: job.partsWaiting.map((p) => ({
      chegadaPrevista: isoDate(p.expectedAt, tz),
      nome: p.partName,
    })),
    reparacaoExterna: openExternal
      ? { regressoPrevisto: isoDate(openExternal.expectedReturnAt, tz) }
      : null,
    valores: {
      emFalta: emFalta === null ? null : eur(ctx, emFalta),
      estimado: estimado === null ? null : eur(ctx, estimado),
      pago: eur(ctx, pago),
      sinal:
        job.depositAmount === null
          ? null
          : eur(ctx, job.depositAmount.toNumber()),
    },
  };
}

/** Carrega o Job e devolve a vistaCliente — null quando não existe. */
export async function loadVistaCliente(
  prisma: PrismaClient,
  jobId: string,
  ctx: CustomerViewCtx
): Promise<CustomerJobView | null> {
  const job = await prisma.job.findUnique({
    select: CUSTOMER_JOB_VIEW_SELECT,
    where: { id: jobId },
  });
  return job ? vistaCliente(job, ctx) : null;
}
