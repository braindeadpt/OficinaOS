import path from "node:path";
import type {
  Prisma,
  TimeEntryDecision,
  TimeEntryStatus,
  TimeEntryType,
} from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  PontoEffectiveStatus,
  PontoEntriesResponse,
  PontoEntryDTO,
  PontoEntryType,
  PontoHoursResponse,
  PontoMissingExitDTO,
  PontoNowState,
  PontoNowUserDTO,
  PontoPendingEntryDTO,
  PontoProofs,
  PontoUserDayHoursDTO,
} from "@shared/types/ponto";
import type { DbClient } from "../repositories/types.js";
import { dayRange, localDayRange, todayRange } from "../utils/time-range.js";

/**
 * Painel "Livro de Ponto" — leitura e escritas manuais sobre
 * time_entries/time_entry_validations/ponto_photos.
 *
 * STATUS EFETIVO (append-only): entry.status é a avaliação da máquina e
 * nunca muda; a decisão da validação MAIS RECENTE sobrepõe-na. Uma entry
 * que é alvo de uma correção (correctsId) sai dos cálculos — a linha de
 * correção entra no fluxo como um evento normal na sua própria hora.
 * Registos com status efetivo RECUSADO também não contam para horas,
 * estado atual nem saídas em falta (foram rejeitados por um humano).
 */

const ENTRY_INCLUDE = {
  corrects: { select: { at: true, id: true, type: true } },
  corrections: {
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { at: true, id: true, type: true },
    take: 1,
  },
  createdBy: { select: { id: true, name: true, username: true } },
  user: {
    select: { id: true, name: true, phoneE164: true, username: true },
  },
  validations: {
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: {
      at: true,
      byUser: { select: { name: true, username: true } },
      decision: true,
      id: true,
      note: true,
    },
  },
} satisfies Prisma.TimeEntryInclude;

type EntryRow = Prisma.TimeEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

export interface PontoRange {
  end: Date;
  fromDate: string;
  start: Date;
  toDate: string;
}

const DEFAULT_RANGE_DAYS = 30;

function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** from/to são dias civis da loja (YYYY-MM-DD). Defaults: últimos 30 dias. */
export function resolvePontoRange(
  from: string | undefined,
  to: string | undefined,
  tz: string
): PontoRange {
  const today = dayRange(tz).date;
  const toDate = to ?? today;
  const fromDate =
    from ??
    ymdOf(
      new Date(
        Date.parse(`${toDate}T00:00:00Z`) - DEFAULT_RANGE_DAYS * 86_400_000
      )
    );
  return {
    end: localDayRange(tz, toDate).end,
    fromDate,
    start: localDayRange(tz, fromDate).start,
    toDate,
  };
}

// Formatadores Intl são caros de construir — o agrupamento por dia
// chama localDateKey por cada picagem (2× por consulta), por isso os
// formatadores ficam em cache por fuso em vez de criados por chamada.
const DTF_CACHE = new Map<string, Intl.DateTimeFormat>();

function cachedDtf(
  cacheKey: string,
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  let fmt = DTF_CACHE.get(cacheKey);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    DTF_CACHE.set(cacheKey, fmt);
  }
  return fmt;
}

/** "YYYY-MM-DD" do instante no fuso da loja (mesmo truque de customer-job-view). */
export function localDateKey(tz: string, d: Date): string {
  return cachedDtf(`date|${tz}`, "en-CA", { timeZone: tz }).format(d);
}

function localMinutesOfDay(tz: string, d: Date): number {
  const parts = cachedDtf(`minutes|${tz}`, "en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: tz,
  }).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get("hour") % 24;
  return hour * 60 + get("minute");
}

/** "HH:MM" → minutos desde a meia-noite; null se inválido. */
function scheduleMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) {
    return null;
  }
  const [h, m] = hhmm.split(":").map(Number);
  if (!(Number.isInteger(h) && Number.isInteger(m))) {
    return null;
  }
  return h * 60 + m;
}

export function effectiveStatusOf(entry: {
  status: TimeEntryStatus;
  validations: { decision: TimeEntryDecision }[];
}): PontoEffectiveStatus {
  return entry.validations[0]?.decision ?? entry.status;
}

/** Uma entry "substituída" por correção não entra nos cálculos. */
export function isSuperseded(entry: { corrections: unknown[] }): boolean {
  return entry.corrections.length > 0;
}

/**
 * Entries que contam para estado/horas/saídas em falta: não substituídas
 * por correção e sem rejeição humana. Ordenadas por `at` ascendente.
 * Tipo estrutural mínimo — não exige o payload completo do Prisma.
 */
export function usableEntries<
  T extends {
    at: Date;
    corrections: unknown[];
    status: TimeEntryStatus;
    type: TimeEntryType;
    validations: { decision: TimeEntryDecision }[];
  },
>(entries: T[]): T[] {
  return entries
    .filter((e) => !isSuperseded(e) && effectiveStatusOf(e) !== "RECUSADO")
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function toDTO(entry: EntryRow): PontoEntryDTO {
  return {
    at: entry.at.toISOString(),
    corrects: entry.corrects
      ? {
          at: entry.corrects.at.toISOString(),
          id: entry.corrects.id,
          type: entry.corrects.type,
        }
      : null,
    correctsId: entry.correctsId,
    correctedBy: entry.corrections[0]
      ? {
          at: entry.corrections[0].at.toISOString(),
          id: entry.corrections[0].id,
          type: entry.corrections[0].type,
        }
      : null,
    createdAt: entry.createdAt.toISOString(),
    createdByName: entry.createdBy?.name || entry.createdBy?.username || null,
    effectiveStatus: effectiveStatusOf(entry),
    hasCorrection: isSuperseded(entry),
    id: entry.id,
    proofs: (entry.proofs ?? {}) as PontoProofs,
    reason: entry.reason,
    status: entry.status,
    transport: entry.transport,
    type: entry.type,
    user: entry.user,
    validations: entry.validations.map((v) => ({
      at: v.at.toISOString(),
      byUserName: v.byUser.name || v.byUser.username,
      decision: v.decision,
      id: v.id,
      note: v.note,
    })),
  };
}

async function findEntries(
  prisma: DbClient,
  where: Prisma.TimeEntryWhereInput,
  order: Prisma.TimeEntryOrderByWithRelationInput[] = [
    { at: "desc" },
    { id: "desc" },
  ]
): Promise<EntryRow[]> {
  return await prisma.timeEntry.findMany({
    include: ENTRY_INCLUDE,
    orderBy: order,
    where,
  });
}

// ── GET /now ────────────────────────────────────────────────────────────

const NOW_STATE_ORDER: Record<PontoNowState, number> = {
  a_trabalhar: 0,
  em_pausa: 1,
  saiu: 2,
  sem_registo: 3,
};

export async function listNow(
  prisma: DbClient,
  tz: string
): Promise<PontoNowUserDTO[]> {
  const today = todayRange(tz);
  const [users, entries] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, phoneE164: true, username: true },
      where: { pontoEnabled: true },
    }),
    findEntries(prisma, {
      at: { gte: today.start, lt: today.end },
    }),
  ]);

  const byUser = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  const items: PontoNowUserDTO[] = users.map((u) => {
    const usable = usableEntries(byUser.get(u.id) ?? []);
    const last = usable.at(-1);
    let state: PontoNowState = "sem_registo";
    if (last) {
      if (last.type === "PAUSA") {
        state = "em_pausa";
      } else if (last.type === "SAIDA") {
        state = "saiu";
      } else {
        state = "a_trabalhar";
      }
    }
    return {
      lastAt: last?.at.toISOString() ?? null,
      lastEntryId: last?.id ?? null,
      lastType: last?.type ?? null,
      name: u.name || u.username,
      phoneE164: u.phoneE164,
      state,
      userId: u.id,
    };
  });

  return items.sort(
    (a, b) =>
      NOW_STATE_ORDER[a.state] - NOW_STATE_ORDER[b.state] ||
      a.name.localeCompare(b.name)
  );
}

// ── GET /entries ────────────────────────────────────────────────────────

export async function listEntries(
  prisma: DbClient,
  range: PontoRange,
  query: {
    limit: number;
    offset: number;
    status?: PontoEffectiveStatus;
    userId?: string;
  }
): Promise<PontoEntriesResponse> {
  const rows = await findEntries(prisma, {
    at: { gte: range.start, lt: range.end },
    ...(query.userId ? { userId: query.userId } : {}),
  });

  const filtered = query.status
    ? rows.filter((e) => effectiveStatusOf(e) === query.status)
    : rows;
  const total = filtered.length;
  const page = filtered.slice(query.offset, query.offset + query.limit);

  return {
    items: page.map(toDTO),
    limit: query.limit,
    offset: query.offset,
    total,
  };
}

// ── GET /pending ────────────────────────────────────────────────────────

export async function listPending(
  prisma: DbClient
): Promise<PontoPendingEntryDTO[]> {
  // status POR_VALIDAR na máquina e ainda sem qualquer validação —
  // uma vez validada (aprovada ou recusada) deixa de estar pendente.
  // Linha já corrigida (a correção é outra entrada — aprovada ou ela
  // própria na fila) também sai: validá-la já não muda o apuramento.
  const rows = await findEntries(
    prisma,
    {
      corrections: { none: {} },
      status: "POR_VALIDAR",
      validations: { none: {} },
    },
    [{ at: "asc" }, { id: "asc" }]
  );

  const photos = rows.length
    ? await prisma.pontoPhoto.findMany({
        orderBy: { createdAt: "desc" },
        select: { entryId: true, id: true },
        where: { entryId: { in: rows.map((r) => r.id) } },
      })
    : [];
  const photosByEntry = new Map<string, { id: string }[]>();
  for (const p of photos) {
    if (!p.entryId) {
      continue;
    }
    const list = photosByEntry.get(p.entryId) ?? [];
    list.push({ id: p.id });
    photosByEntry.set(p.entryId, list);
  }

  return rows.map((e) => ({
    ...toDTO(e),
    photos: (photosByEntry.get(e.id) ?? []).map((p) => ({
      id: p.id,
      url: `/api/ponto/photos/${p.id}`,
    })),
  }));
}

// ── POST /entries/:id/validate ──────────────────────────────────────────

export async function createValidation(
  prisma: DbClient,
  entryId: string,
  actorId: string,
  decision: TimeEntryDecision,
  note: string | null | undefined
) {
  const entry = await prisma.timeEntry.findUnique({
    select: { id: true },
    where: { id: entryId },
  });
  if (!entry) {
    throw new AppError("NOT_FOUND");
  }
  return await prisma.timeEntryValidation.create({
    data: {
      at: new Date(),
      byUserId: actorId,
      decision,
      entryId,
      ...(note ? { note } : {}),
    },
    select: {
      at: true,
      byUser: { select: { name: true, username: true } },
      decision: true,
      id: true,
      note: true,
    },
  });
}

// ── POST /entries (registo manual do gestor) ────────────────────────────

export async function createManualEntry(
  prisma: DbClient,
  actorId: string,
  input: {
    at: string;
    correctsId?: string;
    reason?: string;
    type: TimeEntryType;
    userId: string;
  }
) {
  const user = await prisma.user.findUnique({
    select: { id: true },
    where: { id: input.userId },
  });
  if (!user) {
    throw new AppError("USER_NOT_FOUND");
  }

  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { at: ["validations.invalid_date"] },
    });
  }
  if (at.getTime() > Date.now()) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { at: ["validations.ponto_at_future"] },
    });
  }

  if (input.correctsId) {
    const target = await prisma.timeEntry.findUnique({
      select: { id: true, userId: true },
      where: { id: input.correctsId },
    });
    if (!target) {
      throw new AppError("NOT_FOUND");
    }
    // Uma correção só faz sentido sobre um registo da mesma pessoa.
    if (target.userId !== input.userId) {
      throw new AppError("VALIDATION_ERROR", {
        errors: { correctsId: ["validations.ponto_corrects_other_user"] },
      });
    }
  }

  const created = await prisma.timeEntry.create({
    data: {
      at,
      createdById: actorId,
      proofs: { manual: true },
      reason: input.reason ?? null,
      status: "APROVADO",
      transport: "MANUAL",
      type: input.type,
      userId: input.userId,
      ...(input.correctsId ? { correctsId: input.correctsId } : {}),
    },
    select: { id: true },
  });

  const row = await findEntries(prisma, { id: created.id });
  const dto = row[0] ? toDTO(row[0]) : null;
  return { entry: dto };
}

// ── Agregação por utilizador×dia (horas / esquecimentos / exportar) ─────
//
// Os eventos são primeiro emparelhados em intervalos trabalhados
// (ENTRADA/VOLTEI → PAUSA/SAIDA) e só depois repartidos pelas fronteiras
// dos dias civis da loja. Dividir os eventos por dia ANTES de emparelhar
// perdia as horas de turnos que atravessam a meia-noite: a saída do dia
// seguinte não encontrava a entrada aberta do dia anterior.

/**
 * Projeção leve para os cálculos — chega para o status efetivo e para
 * detectar correções, sem os joins de user/createdBy/corrects que o DTO
 * precisa. O histórico completo por trabalhador é lido, porque o estado
 * "turno aberto" no início do período depende de eventos anteriores.
 */
const COMPUTE_INCLUDE = {
  corrections: { select: { id: true }, take: 1 },
  validations: {
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { decision: true },
    take: 1,
  },
} satisfies Prisma.TimeEntryInclude;

type ComputeRow = Prisma.TimeEntryGetPayload<{
  include: typeof COMPUTE_INCLUDE;
}>;

async function findComputeEntries(
  prisma: DbClient,
  where: Prisma.TimeEntryWhereInput
): Promise<ComputeRow[]> {
  return await prisma.timeEntry.findMany({
    include: COMPUTE_INCLUDE,
    orderBy: [{ at: "asc" }, { id: "asc" }],
    where,
  });
}

/** distinct userId com eventos em [start,end) — barato, sem joins. */
async function findUserIdsInRange(
  prisma: DbClient,
  range: PontoRange,
  userId: string | undefined
): Promise<string[]> {
  const rows = await prisma.timeEntry.findMany({
    distinct: ["userId"],
    select: { userId: true },
    where: {
      at: { gte: range.start, lt: range.end },
      ...(userId ? { userId } : {}),
    },
  });
  return rows.map((r) => r.userId);
}

interface WorkInterval {
  endMs: number;
  startMs: number;
}

/**
 * Emparelha os eventos utilizáveis de UM trabalhador em intervalos
 * [abertura → fecho). Um intervalo ainda aberto conta só até ao fim do
 * dia civil em que abriu (ou até agora, se esse dia ainda não acabou):
 * uma saída esquecida não pode inflar todos os dias seguintes até que
 * alguém registe a correção — os dias intermédios sem eventos continuam
 * sem linha, como antes.
 *
 * Uma abertura (ENTRADA/VOLTEI) JÁ NOUTRO dia civil com o turno ainda
 * aberto fecha o intervalo anterior no fim do dia em que ele abriu: o
 * trabalhador esqueceu-se de picar a saída e voltou no dia seguinte,
 * não é um turno overnight. Sem este corte a SAIDA seguinte fechava o
 * turno antigo e contava também as horas antes da nova ENTRADA.
 */
function pairWorkIntervals(
  usable: ComputeRow[],
  tz: string,
  now: Date
): WorkInterval[] {
  const intervals: WorkInterval[] = [];
  let open: { atMs: number; entry: ComputeRow } | null = null;
  for (const e of usable) {
    if (e.type === "ENTRADA" || e.type === "VOLTEI") {
      if (open) {
        // Abertura noutro dia civil com o turno ainda aberto. As
        // fronteiras de dia só se calculam nesta via — fechada por
        // PAUSA/SAIDA ou no rabo final, a comparação de dias civis
        // (formatador em cache) chega para detetar a mudança.
        const openDay = localDateKey(tz, open.entry.at);
        if (localDateKey(tz, e.at) !== openDay) {
          intervals.push({
            endMs: localDayRange(tz, openDay).end.getTime(),
            startMs: open.atMs,
          });
          open = null;
        }
      }
      // A primeira abertura ganha; entradas/voltas duplicadas no mesmo
      // dia civil não reiniciam o intervalo.
      open ??= { atMs: e.at.getTime(), entry: e };
      continue;
    }
    // PAUSA e SAIDA fecham o intervalo aberto — inclusive no dia civil
    // seguinte, que é como o turno overnight se completa.
    if (open) {
      intervals.push({ endMs: e.at.getTime(), startMs: open.atMs });
      open = null;
    }
  }
  if (open) {
    intervals.push({
      endMs: Math.min(
        now.getTime(),
        localDayRange(tz, localDateKey(tz, open.entry.at)).end.getTime()
      ),
      startMs: open.atMs,
    });
  }
  return intervals;
}

/** Minutos de [dayStart,dayEnd) cobertos pelos intervalos (já em ms). */
function overlapMinutes(
  intervals: WorkInterval[],
  dayStartMs: number,
  dayEndMs: number
): number {
  let ms = 0;
  for (const i of intervals) {
    if (i.startMs >= dayEndMs) {
      break; // intervalos vêm ordenados por startMs
    }
    const s = Math.max(i.startMs, dayStartMs);
    const e = Math.min(i.endMs, dayEndMs);
    if (e > s) {
      ms += e - s;
    }
  }
  return Math.round(ms / 60_000);
}

interface DayScan {
  firstEntradaAt: Date | null;
  lastEntry: ComputeRow | null;
  lastSaidaAt: Date | null;
  lastType: PontoEntryType | null;
}

/** Campos do dia derivados dos eventos DO dia (ordem = cronológica). */
function scanDay(entries: ComputeRow[]): DayScan {
  const scan: DayScan = {
    firstEntradaAt: null,
    lastEntry: null,
    lastSaidaAt: null,
    lastType: null,
  };
  for (const e of entries) {
    scan.lastType = e.type;
    scan.lastEntry = e;
    if (e.type === "ENTRADA" || e.type === "VOLTEI") {
      if (e.type === "ENTRADA" && !scan.firstEntradaAt) {
        scan.firstEntradaAt = e.at;
      }
      continue;
    }
    if (e.type === "SAIDA") {
      scan.lastSaidaAt = e.at;
    }
  }
  return scan;
}

function groupByDay(entries: ComputeRow[], tz: string) {
  const map = new Map<string, ComputeRow[]>();
  for (const e of entries) {
    const date = localDateKey(tz, e.at);
    const list = map.get(date) ?? [];
    list.push(e);
    map.set(date, list);
  }
  return map;
}

function inRange(ymd: string, fromDate: string, toDate: string): boolean {
  return ymd >= fromDate && ymd <= toDate;
}

/**
 * O turno do dia fica "resolvido" quando o evento útil SEGUINTE já fecha
 * o intervalo (PAUSA/SAIDA — típico de turno overnight que termina no dia
 * civil seguinte). Sem isso, o dia anterior ao fecho parecia esquecido.
 */
function resolvedByFollowingClose(
  allUsable: ComputeRow[],
  usablePos: Map<ComputeRow, number>,
  entry: ComputeRow
): boolean {
  const pos = usablePos.get(entry);
  const next = pos === undefined ? undefined : allUsable[pos + 1];
  return next !== undefined && (next.type === "PAUSA" || next.type === "SAIDA");
}

function pushDayHours(
  days: PontoUserDayHoursDTO[],
  args: {
    allUsable: ComputeRow[];
    date: string;
    dayUsable: ComputeRow[];
    intervals: WorkInterval[];
    rawEntries: ComputeRow[];
    scheduleEnd: string | null;
    scheduleStart: string | null;
    todayKey: string;
    tz: string;
    usablePos: Map<ComputeRow, number>;
    userId: string;
    userName: string;
  }
) {
  const {
    allUsable,
    date,
    dayUsable,
    intervals,
    rawEntries,
    scheduleEnd,
    scheduleStart,
    todayKey,
    tz,
    usablePos,
    userId,
    userName,
  } = args;

  const scan = scanDay(dayUsable);
  const { end: dayEnd, start: dayStart } = localDayRange(tz, date);
  const workedMinutes = overlapMinutes(
    intervals,
    dayStart.getTime(),
    dayEnd.getTime()
  );

  const startMin = scheduleMinutes(scheduleStart);
  const endMin = scheduleMinutes(scheduleEnd);
  const lateMinutes =
    scan.firstEntradaAt && startMin !== null
      ? Math.max(0, localMinutesOfDay(tz, scan.firstEntradaAt) - startMin)
      : 0;
  const earlyExitMinutes =
    scan.lastSaidaAt && endMin !== null
      ? Math.max(0, endMin - localMinutesOfDay(tz, scan.lastSaidaAt))
      : 0;

  // "Saída em falta" = o dia acaba sem SAIDA e o turno aberto não é
  // resolvido pelo evento útil seguinte (uma PAUSA/SAIDA no dia seguinte
  // — típico de turno overnight — já conta como fecho). O dia civil atual
  // fica de fora: um turno em curso não é um esquecimento.
  const missingExit =
    scan.lastType !== null &&
    scan.lastType !== "SAIDA" &&
    scan.lastEntry !== null &&
    !resolvedByFollowingClose(allUsable, usablePos, scan.lastEntry) &&
    date !== todayKey;

  days.push({
    date,
    hours: {
      workedMinutes,
      firstEntradaAt: scan.firstEntradaAt?.toISOString() ?? null,
      lastSaidaAt: scan.lastSaidaAt?.toISOString() ?? null,
      lateMinutes,
      earlyExitMinutes,
      missingExit,
      hasCorrection: rawEntries.some(
        (e) => isSuperseded(e) || e.correctsId !== null
      ),
      recusadoCount: rawEntries.filter(
        (e) => effectiveStatusOf(e) === "RECUSADO"
      ).length,
    },
    userId,
    userName,
  });
}

/**
 * Histórico completo dos trabalhadores com eventos no período — os
 * intervalos são path-dependent (um turno aberto no início do período só
 * se calcula vendo os eventos anteriores), por isso a leitura não é
 * limitada às datas pedidas.
 */
async function loadUserHistories(
  prisma: DbClient,
  userIds: string[]
): Promise<Map<string, ComputeRow[]>> {
  const rows = await findComputeEntries(prisma, {
    userId: { in: userIds },
  });
  const byUser = new Map<string, ComputeRow[]>();
  for (const e of rows) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }
  return byUser;
}

// ── GET /hours ──────────────────────────────────────────────────────────

export async function getHours(
  prisma: DbClient,
  tz: string,
  range: PontoRange,
  userId: string | undefined
): Promise<PontoHoursResponse> {
  const now = new Date();
  const todayKey = localDateKey(tz, now);

  const userIds = await findUserIdsInRange(prisma, range, userId);
  if (userIds.length === 0) {
    return { days: [], from: range.fromDate, to: range.toDate };
  }

  const [byUser, users] = await Promise.all([
    loadUserHistories(prisma, userIds),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        pontoScheduleEnd: true,
        pontoScheduleStart: true,
        username: true,
      },
      where: userId ? { id: userId } : {},
    }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));

  const days: PontoUserDayHoursDTO[] = [];
  for (const [uid, rows] of byUser) {
    const u = userById.get(uid);
    const allUsable = usableEntries(rows);
    const usablePos = new Map(allUsable.map((e, i) => [e, i]));
    const intervals = pairWorkIntervals(allUsable, tz, now);
    const rawByDay = groupByDay(rows, tz);
    const usableByDay = groupByDay(allUsable, tz);
    const userName = u?.name || u?.username || uid;

    for (const [date, rawEntries] of rawByDay) {
      if (!inRange(date, range.fromDate, range.toDate)) {
        continue;
      }
      pushDayHours(days, {
        allUsable,
        date,
        dayUsable: usableByDay.get(date) ?? [],
        intervals,
        rawEntries,
        scheduleEnd: u?.pontoScheduleEnd ?? null,
        scheduleStart: u?.pontoScheduleStart ?? null,
        todayKey,
        tz,
        usablePos,
        userId: uid,
        userName,
      });
    }
  }

  days.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.userName.localeCompare(b.userName)
  );
  return { days, from: range.fromDate, to: range.toDate };
}

// ── GET /missing-exits ──────────────────────────────────────────────────

export async function getMissingExits(
  prisma: DbClient,
  tz: string,
  range: PontoRange
): Promise<PontoMissingExitDTO[]> {
  const now = new Date();
  const todayKey = localDateKey(tz, now);

  const userIds = await findUserIdsInRange(prisma, range, undefined);
  if (userIds.length === 0) {
    return [];
  }

  const [byUser, users] = await Promise.all([
    loadUserHistories(prisma, userIds),
    prisma.user.findMany({
      select: { id: true, name: true, username: true },
      where: { id: { in: userIds } },
    }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name || u.username]));

  const items: PontoMissingExitDTO[] = [];
  for (const [uid, rows] of byUser) {
    const allUsable = usableEntries(rows);
    const usablePos = new Map(allUsable.map((e, i) => [e, i]));
    const usableByDay = groupByDay(allUsable, tz);

    for (const [date, dayUsable] of usableByDay) {
      if (!inRange(date, range.fromDate, range.toDate)) {
        continue;
      }
      const last = dayUsable.at(-1);
      if (
        !last ||
        last.type === "SAIDA" ||
        resolvedByFollowingClose(allUsable, usablePos, last) ||
        // O dia civil atual fica de fora — um turno em curso não é uma
        // saída esquecida.
        date === todayKey
      ) {
        continue;
      }
      items.push({
        date,
        lastAt: last.at.toISOString(),
        lastType: last.type,
        userId: uid,
        userName: nameById.get(uid) ?? uid,
      });
    }
  }

  return items.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.userName.localeCompare(b.userName)
  );
}

// ── GET /photos/:photoId — resolução do path (puro, testável) ───────────

/**
 * photo.path é relativo a UPLOAD_DIR; devolve o caminho absoluto ou null
 * quando escapa da pasta (path traversal / path absoluto injectado).
 */
export function resolvePontoPhotoPath(
  uploadDir: string,
  storedPath: string
): string | null {
  const base = path.resolve(uploadDir);
  const full = path.resolve(base, storedPath);
  if (full === base || !full.startsWith(base + path.sep)) {
    return null;
  }
  return full;
}
