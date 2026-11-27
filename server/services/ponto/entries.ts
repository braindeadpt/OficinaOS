// Escritas do livro de ponto: TimeEntry (append-only — nunca UPDATE,
// correções são linhas novas com correctsId). A fotografia do trabalho
// externo nunca é descarregada nem guardada — a prova fica só como
// photoSentAt no JSON da entry; a imagem vive no telemóvel da empresa.

import type {
  Prisma,
  TimeEntryTransport,
  TimeEntryType,
} from "@generated/client";
import type { DbClient } from "../../repositories/types.js";
import { todayRange } from "../../utils/time-range.js";

export interface PontoTimeEntryInput {
  at: Date;
  /** Correção: aponta para a entry substituída (ex.: SAIDA presumida). */
  correctsId?: string | null;
  proofs: Record<string, unknown>;
  reason?: string | null;
  status: "APROVADO" | "POR_VALIDAR";
  transport: TimeEntryTransport;
  type: TimeEntryType;
  userId: string;
}

export function recordPontoEntry(prisma: DbClient, input: PontoTimeEntryInput) {
  return prisma.timeEntry.create({
    data: {
      at: input.at,
      correctsId: input.correctsId ?? null,
      proofs: input.proofs as Prisma.InputJsonValue,
      reason: input.reason ?? null,
      status: input.status,
      transport: input.transport,
      type: input.type,
      userId: input.userId,
      // createdById fica null — o registo é do bot, não de um utilizador.
    },
    select: { id: true },
  });
}

export interface PontoTodayEntry {
  at: Date;
  status: string;
  type: TimeEntryType;
  /** Decisão mais recente do painel — presente só em pontoEntriesSince
   *  (o status da linha não muda com a validação, é append-only). */
  validations?: { decision: string }[];
}

/** Registos do dia civil da loja (fuso das definições) para um user —
 *  usado pelo gate "entrada hoje" e pelo resumo do ESTADO. Desempate
 *  por createdAt: uma PAUSA e a SAIDA presumida ao mesmo instante ficam
 *  com ordem determinística (a escrita mais recente decide o "último").
 *  Linhas anuladas ficam de fora: as já substituídas por uma correção
 *  (senão a original e a correção contavam as duas) e as recusadas
 *  pela gerência — uma entrada recusada não pode valer como pré-
 *  requisito de PAUSA/VOLTEI/SAIDA. */
/** A validação mais recente da linha é recusa? As validações são
 *  append-only e a ÚLTIMA decisão é que conta — uma recusa seguida de
 *  re-aprovação no painel não pode esconder a marcação (por isso o
 *  filtro é em memória sobre validations[0], nunca `none` na query:
 *  esse excluiria a linha mesmo depois de re-aprovada). */
export function latestValidationIsRejection(row: {
  validations?: { decision: string }[];
}): boolean {
  return row.validations?.[0]?.decision === "RECUSADO";
}

const LATEST_VALIDATION_SELECT = {
  orderBy: { at: "desc" as const },
  select: { decision: true },
  take: 1,
};

export async function todayPontoEntries(
  prisma: DbClient,
  userId: string,
  tz: string,
  now = new Date()
): Promise<PontoTodayEntry[]> {
  const { start, end } = todayRange(tz, now);
  const rows = await prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: {
      at: true,
      status: true,
      type: true,
      validations: LATEST_VALIDATION_SELECT,
    },
    where: {
      at: { gte: start, lt: end },
      corrections: { none: {} },
      userId,
    },
  });
  return rows.filter((r) => !latestValidationIsRejection(r));
}

/** SAIDA presumida do dia ainda por corrigir (item 5): proofs
 *  .exitReminderPresumed=true e nenhuma correction a apontar. É a
 *  "pergunta pendente" do fluxo Esquecimentos — a resposta do
 *  trabalhador, uma SAIDA normal ou a correção do painel fecham-na.
 *  Presumida recusada pela gerência NÃO é oferecida: a recusa passa
 *  a decisão para o painel e uma SAIDA normal do trabalhador nunca
 *  a pode substituir por cima da recusa — fica registo novo, e a
 *  presumida recusada continua à espera de decisão do gestor. */
export async function findOpenPresumedExit(
  prisma: DbClient,
  userId: string,
  tz: string,
  now = new Date()
): Promise<{ at: Date; id: string } | null> {
  const { start, end } = todayRange(tz, now);
  const rows = await prisma.timeEntry.findMany({
    orderBy: { at: "desc" },
    select: { at: true, id: true, validations: LATEST_VALIDATION_SELECT },
    where: {
      at: { gte: start, lt: end },
      corrections: { none: {} },
      proofs: { equals: true, path: ["exitReminderPresumed"] },
      type: "SAIDA",
      userId,
    },
  });
  const open = rows.find((r) => !latestValidationIsRejection(r));
  return open ? { at: open.at, id: open.id } : null;
}

/** Registos do user desde um instante (sem limite superior) — o ESTADO
 *  usa para as "horas da semana". Só marcações efetivas: linhas já
 *  substituídas por uma correção (correctsId a apontar para elas, ex.:
 *  a SAIDA presumida corrigida pela resposta ao lembrete) ficam de
 *  fora — senão o resumo listava a presumida e a correção, contava a
 *  pendência em duplicado e fechava o turno na primeira saída. Linhas
 *  recusadas pela gerência também ficam de fora: uma marcação anulada
 *  não conta horas nem aparece no resumo. A decisão mais recente vem
 *  no resultado — o status da linha é o da avaliação automática e não
 *  muda com a validação (append-only), por isso um registo já decidido
 *  no painel não pode continuar a contar como "por validar". */
export async function pontoEntriesSince(
  prisma: DbClient,
  userId: string,
  since: Date
): Promise<PontoTodayEntry[]> {
  const rows = await prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: {
      at: true,
      status: true,
      type: true,
      validations: {
        orderBy: { at: "desc" },
        select: { decision: true },
        take: 1,
      },
    },
    where: {
      at: { gte: since },
      corrections: { none: {} },
      userId,
    },
  });
  return rows.filter((r) => !latestValidationIsRejection(r));
}

// Não existe código de escrita de fotografias: a decisão do dono é que a
// imagem fica apenas no telemóvel da empresa. As provas persistidas são
// hasPhoto/photoSentAt no TimeEntry, nunca bytes nem URLs da fotografia.
