import {
  CashSessionStatus,
  Prisma,
  type PrismaClient,
} from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { Scope } from "@shared/types/dashboard";
import type {
  CashReportDTO,
  CashSessionCounted,
  CashSessionDTO,
} from "@shared/types/reports";
import type { DbClient } from "../repositories/types.js";
import { todayRange, toMoney } from "../utils/time-range.js";
import {
  computeCashReport,
  enrichWithCashSession,
} from "./cash-report.service.js";

type Db = DbClient;

interface CashSessionRow {
  cashDivergence: Prisma.Decimal | null;
  closedAt: Date | null;
  closedBy: { id: string; name: string; username: string } | null;
  countedCash: Prisma.Decimal | null;
  countedNonCash: Prisma.Decimal | null;
  countedTotalCollected: Prisma.Decimal | null;
  day: Date;
  id: string;
  note: string | null;
  openedAt: Date;
  openedBy: { id: string; name: string; username: string };
  reopenCount: number;
  report: unknown;
  signatureDataUrl: string | null;
  status: CashSessionStatus;
  timezone: string;
}

function userName(u: { name: string; username: string }): string {
  return u.name || u.username;
}

function toNumber(
  d: Prisma.Decimal | number | null | undefined
): number | null {
  return d === null || d === undefined ? null : toMoney(Number(d));
}

function toCounted(row: CashSessionRow): CashSessionCounted {
  return {
    cash: toNumber(row.countedCash),
    nonCash: toNumber(row.countedNonCash),
    totalCollected: toNumber(row.countedTotalCollected),
  };
}

function normalizeReport(report: unknown): CashReportDTO {
  // OPEN sessions carry an empty JSON object until first close; CLOSED ones
  // always hold a full snapshot. Guard against unexpected shapes.
  return (report && typeof report === "object" ? report : {}) as CashReportDTO;
}

function toSessionDTO(row: CashSessionRow): CashSessionDTO {
  return {
    id: row.id,
    day: row.day.toISOString(),
    timezone: row.timezone,
    status: row.status === CashSessionStatus.CLOSED ? "CLOSED" : "OPEN",
    openedBy: { id: row.openedBy.id, name: userName(row.openedBy) },
    openedAt: row.openedAt.toISOString(),
    closedBy: row.closedBy
      ? { id: row.closedBy.id, name: userName(row.closedBy) }
      : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    reopenCount: row.reopenCount,
    report: normalizeReport(row.report),
    counted: toCounted(row),
    divergence: { cash: toNumber(row.cashDivergence) },
    note: row.note,
    signatureDataUrl: row.signatureDataUrl,
  };
}

/**
 * The unique key is (day, timezone): the midnight timestamp alone is
 * ambiguous because DST shifts can produce the same UTC instant for
 * different local days. Sessions are always looked up within the
 * shop's current timezone so the key stays stable.
 */
async function findForDay(
  prisma: Db,
  day: Date,
  timezone: string
): Promise<CashSessionRow | null> {
  const row = await prisma.cashSession.findUnique({
    where: { day_timezone: { day, timezone } },
    include: {
      openedBy: { select: { id: true, name: true, username: true } },
      closedBy: { select: { id: true, name: true, username: true } },
    },
  });
  return row ?? null;
}

/**
 * Returns the formal cash session for the caller's shop-local day,
 * implicitly opening one on first access. The session record exists so
 * the day can be closed (cash count + signature) and reopened with a
 * full audit trail (who, when, how many times).
 */
export async function getSessionForDay(
  prisma: PrismaClient,
  scope: Scope,
  now: Date = new Date()
): Promise<CashSessionDTO> {
  const range = todayRange(scope.shopTz, now);
  const db = prisma as unknown as Db;

  const existing = await findForDay(db, range.start, scope.shopTz);
  if (existing) {
    return toSessionDTO(existing);
  }

  try {
    const created = await db.cashSession.create({
      data: {
        day: range.start,
        timezone: scope.shopTz,
        report: {} as Prisma.InputJsonValue,
        openedById: scope.userId,
      },
      include: {
        openedBy: { select: { id: true, name: true, username: true } },
        closedBy: { select: { id: true, name: true, username: true } },
      },
    });
    return toSessionDTO(created);
  } catch (err) {
    // Two owners opening the day at once: the unique key arbitrated.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await findForDay(db, range.start, scope.shopTz);
      if (winner) {
        return toSessionDTO(winner);
      }
    }
    throw err;
  }
}

export interface CloseCashSessionData {
  countedCash: number;
  countedNonCash?: number;
  countedTotalCollected?: number;
  note?: string;
  signatureDataUrl?: string;
}

/**
 * Closes the shop-local day: freezes the system report into the session
 * and records the counted cash, the divergence (counted − system) and an
 * optional signature. Idempotent-unfriendly on purpose: an already closed
 * day must be reopened explicitly first.
 */
export async function closeCashSession(
  prisma: PrismaClient,
  scope: Scope,
  data: CloseCashSessionData,
  now: Date = new Date()
): Promise<CashSessionDTO> {
  const range = todayRange(scope.shopTz, now);
  const session = await getSessionForDay(prisma, scope, now);

  if (session.status === "CLOSED") {
    throw new AppError("CASH_SESSION_ALREADY_CLOSED");
  }

  const report = await computeCashReport(prisma, scope, scope.shopTz, now);
  const cashDivergence = toMoney(data.countedCash - report.summary.cashTotal);

  const db = prisma as unknown as Db;
  const updated = await db.cashSession.update({
    where: { day_timezone: { day: range.start, timezone: scope.shopTz } },
    data: {
      status: CashSessionStatus.CLOSED,
      report: report as unknown as Prisma.InputJsonValue,
      countedCash: data.countedCash,
      countedNonCash: data.countedNonCash ?? null,
      countedTotalCollected: data.countedTotalCollected ?? null,
      cashDivergence,
      note: data.note ?? null,
      signatureDataUrl: data.signatureDataUrl ?? null,
      closedById: scope.userId,
      closedAt: now,
    },
    include: {
      openedBy: { select: { id: true, name: true, username: true } },
      closedBy: { select: { id: true, name: true, username: true } },
    },
  });
  return toSessionDTO(updated);
}

/**
 * Reopens a closed day so late corrections can be entered. The previous
 * signature is wiped (it no longer reflects the ledger) and the reopen is
 * counter-marked on the session — permanently visible in the audit trail.
 */
export async function reopenCashSession(
  prisma: PrismaClient,
  scope: Scope,
  now: Date = new Date()
): Promise<CashSessionDTO> {
  const range = todayRange(scope.shopTz, now);
  const session = await getSessionForDay(prisma, scope, now);

  if (session.status === "OPEN") {
    throw new AppError("CASH_SESSION_NOT_CLOSED");
  }

  const db = prisma as unknown as Db;
  const updated = await db.cashSession.update({
    where: { day_timezone: { day: range.start, timezone: scope.shopTz } },
    data: {
      status: CashSessionStatus.OPEN,
      reopenCount: { increment: 1 },
      countedCash: null,
      countedNonCash: null,
      countedTotalCollected: null,
      cashDivergence: null,
      note: null,
      signatureDataUrl: null,
      closedById: null,
      closedAt: null,
    },
    include: {
      openedBy: { select: { id: true, name: true, username: true } },
      closedBy: { select: { id: true, name: true, username: true } },
    },
  });
  return toSessionDTO(updated);
}

/**
 * Read-model used by the reports UI: today's session (auto-opened) plus
 * the live report figures. While OPEN the report is recomputed on every
 * read; after CLOSE the frozen snapshot in the session row wins.
 */
export async function getSessionWithReport(
  prisma: PrismaClient,
  scope: Scope,
  now: Date = new Date()
): Promise<CashSessionDTO & { liveReport: CashReportDTO }> {
  const session = await getSessionForDay(prisma, scope, now);
  const liveReport = await computeCashReport(prisma, scope, scope.shopTz, now);
  // session.report is the frozen snapshot once CLOSED and empty-ish while
  // OPEN; the UI compares it against liveReport to show live vs frozen.
  return enrichWithCashSession(session, liveReport);
}
