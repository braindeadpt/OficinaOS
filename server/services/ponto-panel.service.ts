import path from "node:path";
import type {
  Prisma,
  TimeEntryDecision,
  TimeEntryStatus,
  TimeEntryType,
} from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  PontoDayHoursDTO,
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

/** "YYYY-MM-DD" do instante no fuso da loja (mesmo truque de customer-job-view). */
export function localDateKey(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function localMinutesOfDay(tz: string, d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
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
  const rows = await findEntries(
    prisma,
    { status: "POR_VALIDAR", validations: { none: {} } },
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

interface DayComputation {
  day: PontoDayHoursDTO;
  entries: EntryRow[];
}

interface DayWalk {
  firstEntradaAt: Date | null;
  lastSaidaAt: Date | null;
  lastType: PontoEntryType | null;
  workedMs: number;
}

/**
 * Percorre os eventos do dia acumulando intervalos trabalhados.
 * ENTRADA/VOLTEI abrem; PAUSA/SAIDA fecham. Intervalo aberto no fim conta
 * até openCap (agora ou meia-noite local).
 */
function walkDay(entries: EntryRow[], openCap: number): DayWalk {
  let workedMs = 0;
  let openSince: number | null = null;
  const walk: DayWalk = {
    firstEntradaAt: null,
    lastSaidaAt: null,
    lastType: null,
    workedMs: 0,
  };

  for (const e of entries) {
    walk.lastType = e.type;
    if (e.type === "ENTRADA" || e.type === "VOLTEI") {
      openSince ??= e.at.getTime();
      if (e.type === "ENTRADA" && !walk.firstEntradaAt) {
        walk.firstEntradaAt = e.at;
      }
      continue;
    }
    if (openSince !== null) {
      workedMs += e.at.getTime() - openSince;
      openSince = null;
    }
    if (e.type === "SAIDA") {
      walk.lastSaidaAt = e.at;
    }
  }
  if (openSince !== null) {
    workedMs += Math.max(0, openCap - openSince);
  }
  walk.workedMs = workedMs;
  return walk;
}

function computeDay(
  entries: EntryRow[],
  tz: string,
  scheduleStart: string | null,
  scheduleEnd: string | null,
  now: Date
): DayComputation {
  const usable = usableEntries(entries);
  const recusadoCount = entries.filter(
    (e) => effectiveStatusOf(e) === "RECUSADO"
  ).length;

  const ymd = localDateKey(tz, entries[0]?.at ?? now);
  const openCap = Math.min(now.getTime(), localDayRange(tz, ymd).end.getTime());
  const { firstEntradaAt, lastSaidaAt, lastType, workedMs } = walkDay(
    usable,
    openCap
  );

  const startMin = scheduleMinutes(scheduleStart);
  const endMin = scheduleMinutes(scheduleEnd);
  const lateMinutes =
    firstEntradaAt && startMin !== null
      ? Math.max(0, localMinutesOfDay(tz, firstEntradaAt) - startMin)
      : 0;
  const earlyExitMinutes =
    lastSaidaAt && endMin !== null
      ? Math.max(0, endMin - localMinutesOfDay(tz, lastSaidaAt))
      : 0;

  return {
    day: {
      workedMinutes: Math.round(workedMs / 60_000),
      firstEntradaAt: firstEntradaAt?.toISOString() ?? null,
      lastSaidaAt: lastSaidaAt?.toISOString() ?? null,
      lateMinutes,
      earlyExitMinutes,
      missingExit: lastType !== null && lastType !== "SAIDA",
      hasCorrection: entries.some(
        (e) => isSuperseded(e) || e.correctsId !== null
      ),
      recusadoCount,
    },
    entries: usable,
  };
}

interface DayGroup {
  date: string;
  entries: EntryRow[];
  userId: string;
}

function groupByUserDay(
  entries: EntryRow[],
  tz: string
): Map<string, DayGroup> {
  const map = new Map<string, DayGroup>();
  for (const e of entries) {
    const date = localDateKey(tz, e.at);
    const key = `${e.userId}${date}`;
    const g = map.get(key) ?? { date, entries: [], userId: e.userId };
    g.entries.push(e);
    map.set(key, g);
  }
  return map;
}

// ── GET /hours ──────────────────────────────────────────────────────────

export async function getHours(
  prisma: DbClient,
  tz: string,
  range: PontoRange,
  userId: string | undefined
): Promise<PontoHoursResponse> {
  const [entries, users] = await Promise.all([
    findEntries(prisma, {
      at: { gte: range.start, lt: range.end },
      ...(userId ? { userId } : {}),
    }),
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

  const groups = groupByUserDay(entries, tz);
  const now = new Date();
  const days: PontoUserDayHoursDTO[] = [...groups.values()]
    .map((g) => {
      const u = userById.get(g.userId);
      const { day } = computeDay(
        g.entries,
        tz,
        u?.pontoScheduleStart ?? null,
        u?.pontoScheduleEnd ?? null,
        now
      );
      return {
        date: g.date,
        hours: day,
        userId: g.userId,
        userName: u?.name || u?.username || g.userId,
      };
    })
    .sort(
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
  const entries = await findEntries(prisma, {
    at: { gte: range.start, lt: range.end },
  });
  const groups = groupByUserDay(entries, tz);

  const userIds = [...new Set([...groups.values()].map((g) => g.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        select: { id: true, name: true, username: true },
        where: { id: { in: userIds } },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name || u.username]));

  const items: PontoMissingExitDTO[] = [];
  for (const g of groups.values()) {
    const usable = usableEntries(g.entries);
    const last = usable.at(-1);
    if (!last || last.type === "SAIDA") {
      continue;
    }
    items.push({
      date: g.date,
      lastAt: last.at.toISOString(),
      lastType: last.type,
      userId: g.userId,
      userName: nameById.get(g.userId) ?? g.userId,
    });
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
