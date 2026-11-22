import type { PrismaClient } from "@generated/client";
import { ACTIVE_STATUSES } from "@shared/constants/job-statuses.js";
import type { FastifyBaseLogger } from "fastify";
import { type CustomerViewCtx, loadVistaCliente } from "./customer-job-view.js";

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
      return {
        result: {
          historico: jobs.map((j) => ({
            aparelho: `${j.device.brand.name} ${j.device.model}`,
            codigo: j.jobCode,
            estado: vistaClienteStatusPt(j.status),
            fechadoEm: j.updatedAt.toISOString().slice(0, 10),
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

function vistaClienteStatusPt(status: string): string {
  const map: Record<string, string> = {
    CANCELLED: "Cancelado",
    DELIVERED: "Entregue",
    DONE: "Pronto para levantar",
    RETURNED: "Devolvido",
  };
  return map[status] ?? status;
}
