import crypto from "node:crypto";
import type { Prisma } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  PontoActDayDTO,
  PontoActEntryDTO,
  PontoActExportResponse,
  PontoActLinkedEntryDTO,
  PontoActValidationDTO,
  PontoActWeekDTO,
  PontoActWorkerDTO,
} from "@shared/types/ponto";
import type { DbClient } from "../repositories/types.js";
import { localDayRange } from "../utils/time-range.js";
import {
  getHours,
  isSuperseded,
  localDateKey,
  type PontoRange,
  usableEntries,
} from "./ponto-panel.service.js";

/**
 * Exportação para a ACT (art. 202.º CT): leitura exclusivamente local de
 * time_entries/users/shop_settings. Nunca chama a Cloud nem verifica
 * entitlements — a retenção legal de 5 anos sobrevive ao fim do Pro.
 */

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
} as const;

const LINKED_ENTRY_INCLUDE = {
  createdBy: { select: USER_SELECT },
  validations: {
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { decision: true },
    take: 1,
  },
} satisfies Prisma.TimeEntryInclude;

const ACT_ENTRY_INCLUDE = {
  corrections: {
    include: LINKED_ENTRY_INCLUDE,
    orderBy: [{ at: "asc" }, { id: "asc" }],
  },
  corrects: { include: LINKED_ENTRY_INCLUDE },
  createdBy: { select: USER_SELECT },
  user: { select: USER_SELECT },
  validations: {
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: {
      at: true,
      byUser: { select: USER_SELECT },
      decision: true,
      note: true,
    },
  },
} satisfies Prisma.TimeEntryInclude;

type ActEntryRow = Prisma.TimeEntryGetPayload<{
  include: typeof ACT_ENTRY_INCLUDE;
}>;

interface LinkedEntryRow {
  at: Date;
  createdAt: Date;
  createdBy: { name: string; username: string } | null;
  id: string;
  reason: string | null;
  status: ActEntryRow["status"];
  transport: ActEntryRow["transport"];
  type: ActEntryRow["type"];
  validations: { decision: ActEntryRow["validations"][number]["decision"] }[];
}

/** JSON canónico estável: chaves ordenadas, sem undefined, UTF-8. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  const body = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",");
  return `{${body}}`;
}

export function sha256CanonicalJson(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function displayName(user: { name: string; username: string }): string {
  return user.name || user.username;
}

function linkedDTO(entry: LinkedEntryRow): PontoActLinkedEntryDTO {
  return {
    at: entry.at.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    createdByName: entry.createdBy ? displayName(entry.createdBy) : null,
    effectiveStatus: entry.validations[0]?.decision ?? entry.status,
    id: entry.id,
    reason: entry.reason,
    status: entry.status,
    transport: entry.transport,
    type: entry.type,
  };
}

function validationsDTO(entry: ActEntryRow): PontoActValidationDTO[] {
  return entry.validations.map((validation) => ({
    at: validation.at.toISOString(),
    byUserName: validation.byUser ? displayName(validation.byUser) : null,
    decision: validation.decision,
    note: validation.note,
  }));
}

function entryDTO(entry: ActEntryRow): PontoActEntryDTO {
  return {
    ...linkedDTO(entry),
    corrections: entry.corrections.map((correction) => linkedDTO(correction)),
    corrects: entry.corrects ? linkedDTO(entry.corrects) : null,
    correctsId: entry.correctsId,
    superseded: isSuperseded(entry),
    validations: validationsDTO(entry),
  };
}

function ymdAddDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Semana civil de trabalho usada no relatório: segunda a domingo. */
export function actWeekStart(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  return ymdAddDays(ymd, -mondayIndex);
}

function pauseMinutesForDay(args: {
  date: string;
  entries: ActEntryRow[];
  now: Date;
  todayKey: string;
  tz: string;
}): number {
  const usable = usableEntries(args.entries);
  const { end: dayEnd } = localDayRange(args.tz, args.date);
  let openPauseMs: number | null = null;
  let pauseMs = 0;

  for (const entry of usable) {
    if (entry.type === "PAUSA") {
      openPauseMs ??= entry.at.getTime();
      continue;
    }
    if (
      (entry.type === "VOLTEI" || entry.type === "SAIDA") &&
      openPauseMs !== null
    ) {
      pauseMs += Math.max(0, entry.at.getTime() - openPauseMs);
      openPauseMs = null;
    }
  }

  if (openPauseMs !== null) {
    // Uma pausa por fechar nunca atravessa a meia-noite — segue a mesma
    // decisão sem overnight do painel. No dia atual conta até agora.
    const cutoff =
      args.date === args.todayKey
        ? Math.min(args.now.getTime(), dayEnd.getTime())
        : dayEnd.getTime();
    pauseMs += Math.max(0, cutoff - openPauseMs);
  }
  return Math.round(pauseMs / 60_000);
}

function groupRangeRows(rows: ActEntryRow[], tz: string) {
  const byUser = new Map<string, Map<string, ActEntryRow[]>>();
  for (const row of rows) {
    const date = localDateKey(tz, row.at);
    let byDay = byUser.get(row.userId);
    if (!byDay) {
      byDay = new Map<string, ActEntryRow[]>();
      byUser.set(row.userId, byDay);
    }
    const list = byDay.get(date) ?? [];
    list.push(row);
    byDay.set(date, list);
  }
  return byUser;
}

function weeksFromDays(days: PontoActDayDTO[]): PontoActWeekDTO[] {
  const byWeek = new Map<string, number>();
  for (const day of days) {
    byWeek.set(
      day.weekStart,
      (byWeek.get(day.weekStart) ?? 0) + day.workedMinutes
    );
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, workedMinutes]) => ({
      end: ymdAddDays(start, 6),
      start,
      workedMinutes,
    }));
}

export async function getPontoActExport(
  prisma: DbClient,
  args: {
    actorId: string;
    range: PontoRange;
    tz: string;
    userId?: string;
  },
  now = new Date()
): Promise<PontoActExportResponse> {
  const workerWhere = args.userId
    ? { id: args.userId }
    : {
        OR: [
          { pontoEnabled: true },
          {
            timeEntries: {
              some: {
                at: { gte: args.range.start, lt: args.range.end },
              },
            },
          },
        ],
      };

  const [settings, actor, users, rows, hours] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { id: "default" } }),
    prisma.user.findUnique({
      select: USER_SELECT,
      where: { id: args.actorId },
    }),
    prisma.user.findMany({
      orderBy: [{ name: "asc" }, { username: "asc" }],
      select: {
        externalWork: true,
        id: true,
        name: true,
        pontoScheduleEnd: true,
        pontoScheduleExempt: true,
        pontoScheduleStart: true,
        username: true,
      },
      where: workerWhere,
    }),
    prisma.timeEntry.findMany({
      include: ACT_ENTRY_INCLUDE,
      orderBy: [{ at: "asc" }, { id: "asc" }],
      where: {
        at: { gte: args.range.start, lt: args.range.end },
        ...(args.userId ? { userId: args.userId } : {}),
      },
    }),
    getHours(prisma, args.tz, args.range, args.userId),
  ]);

  if (!actor) {
    throw new AppError("USER_NOT_FOUND");
  }
  if (args.userId && users.length === 0) {
    throw new AppError("USER_NOT_FOUND");
  }

  const rowsByUserAndDay = groupRangeRows(rows, args.tz);
  const hoursByUserDay = new Map(
    hours.days.map(
      (day) => [`${day.userId}|${day.date}`, day.hours.workedMinutes] as const
    )
  );
  const todayKey = localDateKey(args.tz, now);

  const workers: PontoActWorkerDTO[] = users.map((user) => {
    const byDay =
      rowsByUserAndDay.get(user.id) ?? new Map<string, ActEntryRow[]>();
    const days: PontoActDayDTO[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entries]) => ({
        date,
        entries: entries.map(entryDTO),
        pauseMinutes: pauseMinutesForDay({
          date,
          entries,
          now,
          todayKey,
          tz: args.tz,
        }),
        weekStart: actWeekStart(date),
        workedMinutes: hoursByUserDay.get(`${user.id}|${date}`) ?? 0,
      }));
    const weeks = weeksFromDays(days);
    return {
      days,
      externalWork: user.externalWork,
      name: displayName(user),
      scheduleEnd: user.pontoScheduleEnd,
      scheduleExempt: user.pontoScheduleExempt,
      scheduleStart: user.pontoScheduleStart,
      totalMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
      userId: user.id,
      username: user.username,
      weeks,
    };
  });

  const content = {
    company: {
      address: settings?.address ?? null,
      locality: settings?.shopLocality ?? null,
      name: settings?.shopName ?? "",
      phone: settings?.phone ?? null,
      taxId: settings?.shopTaxId ?? null,
    },
    exportedAt: now.toISOString(),
    exportedBy: {
      id: actor.id,
      name: displayName(actor),
      username: actor.username,
    },
    period: {
      from: args.range.fromDate,
      timeZone: args.tz,
      to: args.range.toDate,
    },
    workers,
  };

  return {
    ...content,
    contentHash: sha256CanonicalJson(content),
    hashAlgorithm: "SHA-256",
    hashInput: "canonical-json-v1",
  };
}
