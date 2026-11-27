import { AuditAction, type PrismaClient } from "@generated/client";
import { ACTIVE_STATUSES } from "@shared/constants/job-statuses.js";
import type { FastifyBaseLogger } from "fastify";
import {
  type CustomerViewCtx,
  JOB_STATUS_I18N,
  JOB_STATUS_PT,
  loadVistaCliente,
} from "./customer-job-view.js";

/** Data de fecho por job — a transição para o estado ATUAL (última
 *  ocorrência desse toValue no audit trail). «Entregue» mostra a data da
 *  entrega, não a do «Pronto para levantar» que lhe antecedeu; se o
 *  audit não tiver essa transição, cai na primeira data terminal. */
async function closedAtByJob(
  prisma: PrismaClient,
  jobs: { id: string; status: string }[]
): Promise<Map<string, Date>> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, jobId: true, toValue: true },
    where: {
      action: AuditAction.STATUS_CHANGED,
      jobId: { in: jobs.map((j) => j.id) },
      toValue: { in: ["DONE", "DELIVERED", "RETURNED", "CANCELLED"] },
    },
  });
  const firstTerminal = new Map<string, Date>();
  const currentStatus = new Map<string, Date>();
  for (const r of rows) {
    if (!r.jobId) {
      continue;
    }
    if (!firstTerminal.has(r.jobId)) {
      firstTerminal.set(r.jobId, r.createdAt);
    }
    if (r.toValue === jobs.find((j) => j.id === r.jobId)?.status) {
      currentStatus.set(r.jobId, r.createdAt);
    }
  }
  const map = new Map<string, Date>();
  for (const j of jobs) {
    const at = currentStatus.get(j.id) ?? firstTerminal.get(j.id);
    if (at) {
      map.set(j.id, at);
    }
  }
  return map;
}

/**
 * Ferramentas fechadas que o bot de IA pode invocar (§E.4 do plano).
 * Correm TODAS na app da loja — a Cloud pede, a app executa, e só o
 * resultado allowlisted volta. Nenhuma ferramenta toca em dados de outro
 * cliente: o código REP de outra pessoa devolve "nao_encontrado".
 */

export const BOT_TOOL_NAMES = [
  "ver_reparacoes",
  "ver_detalhe",
  "ver_orcamento",
  "ver_historico",
  "info_loja",
  "pedir_humano",
] as const;

export type BotToolName = (typeof BOT_TOOL_NAMES)[number];

export interface BotToolCtx extends CustomerViewCtx {
  /** Customer ids matched to the sender phone — tools never escape this scope. */
  customerIds: string[];
  log: FastifyBaseLogger;
  prisma: PrismaClient;
  /** Ficha "O que o bot pode dizer" (settings). */
  shopCard: {
    botAvgRepairDaysAfterPart: number;
    botInfoText: string | null;
  };
}

export interface BotToolResult {
  /** pedir_humano marks the conversation for staff escalation. */
  escalate?: boolean;
  result: unknown;
}

const JOB_CODE_RE = /^REP-\d{4}-\d{6}-[A-Z0-9]{3}$/i;

function notFound(): BotToolResult {
  // Same shape for "doesn't exist" and "belongs to another customer" —
  // never confirm a code exists but isn't yours.
  return { result: { erro: "nao_encontrado" } };
}

async function findOwnedJobByCode(ctx: BotToolCtx, codigo: unknown) {
  if (typeof codigo !== "string" || !JOB_CODE_RE.test(codigo.trim())) {
    return null;
  }
  const job = await ctx.prisma.job.findFirst({
    select: { id: true },
    where: {
      customerId: { in: ctx.customerIds },
      jobCode: codigo.trim().toUpperCase(),
    },
  });
  return job;
}

export async function runBotTool(
  ctx: BotToolCtx,
  name: string,
  args: Record<string, unknown> | undefined
): Promise<BotToolResult> {
  switch (name) {
    case "ver_reparacoes": {
      const jobs = await ctx.prisma.job.findMany({
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        where: {
          customerId: { in: ctx.customerIds },
          status: { in: ACTIVE_STATUSES },
        },
      });
      const views = await Promise.all(
        jobs.map(async (j) => {
          const view = await loadVistaCliente(ctx.prisma, j.id, ctx);
          // Compact summary — the model can call ver_detalhe for the rest.
          return view
            ? {
                aparelho: view.aparelho,
                codigo: view.codigo,
                dataPrevista: view.dataPrevista,
                diasAtraso: view.diasAtraso,
                emPausa: view.emPausa,
                estado: view.estado,
              }
            : null;
        })
      );
      return { result: { reparacoes: views.filter(Boolean) } };
    }

    case "ver_detalhe": {
      const job = await findOwnedJobByCode(ctx, args?.codigo);
      if (!job) {
        return notFound();
      }
      const view = await loadVistaCliente(ctx.prisma, job.id, ctx);
      return view ? { result: view } : notFound();
    }

    case "ver_orcamento": {
      const job = await findOwnedJobByCode(ctx, args?.codigo);
      if (!job) {
        return notFound();
      }
      const view = await loadVistaCliente(ctx.prisma, job.id, ctx);
      if (!view?.orcamento) {
        return { result: { codigo: view?.codigo ?? null, orcamento: null } };
      }
      return {
        result: {
          codigo: view.codigo,
          orcamento: view.orcamento,
          valores: view.valores,
        },
      };
    }

    case "ver_historico": {
      const jobs = await ctx.prisma.job.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          device: {
            select: { brand: { select: { name: true } }, model: true },
          },
          id: true,
          jobCode: true,
          status: true,
          updatedAt: true,
        },
        take: 5,
        where: {
          customerId: { in: ctx.customerIds },
          status: { in: ["DONE", "DELIVERED", "RETURNED", "CANCELLED"] },
        },
      });
      // A data de fecho real vem do audit trail (primeira transição para
      // um estado final) — updatedAt muda com qualquer edição posterior,
      // ex.: publicar o link de tracking.
      const closedAt = await closedAtByJob(
        ctx.prisma,
        jobs.map((j) => ({ id: j.id, status: j.status }))
      );
      return {
        result: {
          historico: jobs.map((j) => ({
            aparelho: `${j.device.brand.name} ${j.device.model}`,
            codigo: j.jobCode,
            estado: vistaClienteStatus(j.status, ctx.locale),
            fechadoEm: (closedAt.get(j.id) ?? j.updatedAt)
              .toISOString()
              .slice(0, 10),
          })),
        },
      };
    }

    case "info_loja": {
      return {
        result: {
          diasMediosReparacaoAposPeca: ctx.shopCard.botAvgRepairDaysAfterPart,
          info: ctx.shopCard.botInfoText,
        },
      };
    }

    case "pedir_humano": {
      return {
        escalate: true,
        result: { ok: true, resumo: "Um membro da equipa responde em breve." },
      };
    }

    default:
      // Ferramenta desconhecida — nunca executar nada fora da lista.
      ctx.log.warn({ tool: name }, "bot-ai: unknown tool requested");
      return { result: { erro: "ferramenta_desconhecida" } };
  }
}

function vistaClienteStatus(status: string, locale?: string): string {
  const lang = (locale ?? "pt").split("-")[0];
  return (JOB_STATUS_I18N[lang] ?? JOB_STATUS_PT)[status] ?? status;
}
