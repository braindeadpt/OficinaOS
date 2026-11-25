import type { Prisma } from "@generated/client";

export interface DateRange {
  end: Date;
  start: Date;
}

function zonedParts(tz: string, d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === "24" ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Convert a zoned (year, month, day) at midnight to a UTC Date.
 * The offset is computed at the candidate instant and refined until the
 * zoned reading lands exactly on local midnight — a single pass over
 * noon's offset misplaces the boundary by an hour on DST transition days
 * (the offset changes between midnight and noon).
 */
function utcFromZonedYmd(tz: string, y: number, m: number, d: number): Date {
  const targetUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instant = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(tz, new Date(instant));
    const zonedEpoch = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
    const offsetMs = instant - zonedEpoch;
    const candidate = targetUtc + offsetMs;
    const cp = zonedParts(tz, new Date(candidate));
    if (
      cp.year === y &&
      cp.month === m &&
      cp.day === d &&
      cp.hour === 0 &&
      cp.minute === 0 &&
      cp.second === 0
    ) {
      return new Date(candidate);
    }
    instant = candidate;
  }
  return new Date(instant);
}

/**
 * Instante UTC do HH:MM de um dia civil ("YYYY-MM-DD") no fuso `tz` —
 * mesmo refinamento iterativo de utcFromZonedYmd (o offset muda entre a
 * meia-noite e o meio-dia em dias de DST). Usado pelo livro de ponto:
 * a hora do lembrete de saída e a hora de saída declarada pelo
 * trabalhador são horas de relógio da loja, não instantes absolutos.
 * Devolve null para entradas mal formadas.
 */
export function zonedDateTimeToUtc(
  tz: string,
  ymd: string,
  hhmm: string
): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  if (
    ![y, m, d, hh, mm].every(Number.isInteger) ||
    hh > 23 ||
    mm > 59 ||
    hh < 0 ||
    mm < 0
  ) {
    return null;
  }
  const targetUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Semente ao meio-dia do mesmo dia — longe das bordas de DST.
  let instant = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(tz, new Date(instant));
    const zonedEpoch = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
    const offsetMs = instant - zonedEpoch;
    const candidate = targetUtc + offsetMs;
    const cp = zonedParts(tz, new Date(candidate));
    if (
      cp.year === y &&
      cp.month === m &&
      cp.day === d &&
      cp.hour === hh &&
      cp.minute === mm &&
      cp.second === 0
    ) {
      return new Date(candidate);
    }
    instant = candidate;
  }
  return new Date(instant);
}

export function todayRange(tz: string, now: Date = new Date()): DateRange {
  const { year, month, day } = zonedParts(tz, now);
  const start = utcFromZonedYmd(tz, year, month, day);

  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const end = utcFromZonedYmd(
    tz,
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate()
  );

  return { start, end };
}

/**
 * Bounds [start, end) of the shop-local calendar day containing `at`, in
 * timezone `tz`, plus the local ISO date string (`YYYY-MM-DD`) that labels
 * it. Unlike slicing the instant's own ISO date, this matches the day a
 * person at the shop would call that moment.
 */
export function dayRange(
  tz: string,
  at: Date = new Date()
): DateRange & { date: string } {
  const { year, month, day } = zonedParts(tz, at);
  const start = utcFromZonedYmd(tz, year, month, day);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = utcFromZonedYmd(
    tz,
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate()
  );
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return { start, end, date: `${year}-${mm}-${dd}` };
}

/**
 * Bounds [start, end) of a shop-local calendar day given as "YYYY-MM-DD".
 * Unlike dayRange (which takes an instant and finds its local day), this
 * starts from the civil date itself — the label the user picked.
 */
export function localDayRange(tz: string, ymd: string): DateRange {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = utcFromZonedYmd(tz, y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = utcFromZonedYmd(
    tz,
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate()
  );
  return { start, end };
}

export function monthRange(tz: string, now: Date = new Date()): DateRange {
  const { year, month } = zonedParts(tz, now);
  const start = utcFromZonedYmd(tz, year, month, 1);
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const end = utcFromZonedYmd(tz, nextY, nextM, 1);
  return { start, end };
}

export function prevMonthRange(tz: string, now: Date = new Date()): DateRange {
  const { year, month } = zonedParts(tz, now);
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const start = utcFromZonedYmd(tz, prevY, prevM, 1);
  const end = utcFromZonedYmd(tz, year, month, 1);
  return { start, end };
}

export function toMoney(d: Prisma.Decimal | number | null | undefined): number {
  if (d === null || d === undefined) {
    return 0;
  }
  const n = typeof d === "number" ? d : Number(d.toString());
  return Math.round(n * 100) / 100;
}
