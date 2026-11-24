import type {
  PontoDayHoursDTO,
  PontoEntryDTO,
  PontoEntryType,
} from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { usePontoStore } from "@/stores/ponto";
import { useSettingsStore } from "@/stores/settings";

export const TYPE_LABEL: Record<PontoEntryType, string> = {
  ENTRADA: "ponto.type_entrada",
  PAUSA: "ponto.type_pausa",
  SAIDA: "ponto.type_saida",
  VOLTEI: "ponto.type_voltei",
};

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
}

/**
 * Hora de um registo de ponto. O agrupamento dos dias é sempre no fuso
 * da loja — sem `timeZone` o browser mostraria a hora do dispositivo, que
 * pode ser outro (ex.: gerente em Lisboa a exportar uma loja nos Açores).
 */
export function formatClock(
  iso: string | null,
  locale: string,
  timeZone?: string
): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * "YYYY-MM-DD" é um dia CIVIL da loja, não um instante — constrói-se como
 * data local para o rótulo nunca deslizar um dia em fusos extremos.
 */
export function formatDay(ymd: string, locale: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    weekday: "short",
  });
}

// ── Fuso da loja ────────────────────────────────────────────────────────

/**
 * Fuso IANA da loja. Fonte primária: /ponto/status, que devolve o fuso
 * efetivo já resolvido no servidor (ShopSettings.timezone com fallback
 * env TZ — o cliente não conhece esse fallback). ShopSettings.timezone
 * fica como reserva enquanto o status não chega; undefined depois disso
 * faz o chamador cair no fuso do dispositivo.
 */
export function useShopTz(): string | undefined {
  const statusTz = usePontoStore((s) => s.tz);
  const settingTz = useSettingsStore((s) => s.shopSettings?.timezone);
  return statusTz ?? settingTz ?? undefined;
}

/** "YYYY-MM-DD" do instante no fuso da loja (mesmo truque do servidor). */
export function shopDateKey(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** Dia civil da loja que contém `now` — base dos defaults dos filtros. */
export function shopToday(tz: string): string {
  return shopDateKey(tz, new Date());
}

/** `n` dias civis antes de hoje NA LOJA (aritmética em YYYY-MM-DD). */
export function ymdDaysAgo(n: number, tz: string): string {
  const today = shopToday(tz);
  return new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Soma `n` dias a um "YYYY-MM-DD" (aritmética civil, sem fuso). */
export function ymdAddDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function zonedParts(
  tz: string,
  d: Date
): { day: number; hour: number; minute: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: tz,
    year: "numeric",
  }).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    month: get("month"),
    year: get("year"),
  };
}

/**
 * Converte "YYYY-MM-DD" + "HH:MM" lidos NO FUSO DA LOJA num instante UTC.
 * O input datetime-local devolve hora de parede — interpretá-la no fuso
 * do dispositivo gravava a saída no dia errado (o caso dos Açores/Lisboa).
 * Devolve null se os argumentos não formarem uma data válida.
 */
export function shopWallTimeToUtc(
  tz: string,
  ymd: string,
  hhmm: string
): Date | null {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  if (
    !(
      Number.isInteger(y) &&
      Number.isInteger(mo) &&
      Number.isInteger(d) &&
      Number.isInteger(h) &&
      Number.isInteger(mi)
    ) ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > 31 ||
    h < 0 ||
    h > 23 ||
    mi < 0 ||
    mi > 59
  ) {
    return null;
  }
  const targetUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  // Itera o offset: cada passagem refina o instante até a leitura zoned
  // coincidir com a hora de parede pedida (2 voltas chegam; DST na
  // transição pode precisar de mais — daí o teto de 4, como no servidor).
  let instant = targetUtc;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(tz, new Date(instant));
    const zonedEpoch = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      0
    );
    const offsetMs = instant - zonedEpoch;
    const candidate = targetUtc + offsetMs;
    const cp = zonedParts(tz, new Date(candidate));
    if (
      cp.year === y &&
      cp.month === mo &&
      cp.day === d &&
      cp.hour === h &&
      cp.minute === mi
    ) {
      return new Date(candidate);
    }
    instant = candidate;
  }
  return null;
}

/**
 * Resumo das provas de uma picagem, já traduzido — "photo", "manual" e
 * "code!" são texto visível ao utilizador e passam por i18n como o resto
 * do painel.
 */
export function proofSummary(
  p: PontoEntryDTO["proofs"],
  t: TFunction
): string[] {
  const out: string[] = [];
  if (p.onShopWifi) {
    out.push("wifi");
  }
  if (typeof p.distanceM === "number") {
    out.push(`${Math.round(p.distanceM)}m`);
  }
  if (p.accuracy != null) {
    out.push(`±${Math.round(p.accuracy)}m`);
  }
  if (p.codeValid === false) {
    out.push(t("ponto.proof_code_invalid"));
  }
  if (p.hasPhoto || p.photoId) {
    out.push(t("ponto.proof_photo"));
  }
  if (p.manual) {
    out.push(t("ponto.proof_manual"));
  }
  return out;
}

export function hoursFlags(h: PontoDayHoursDTO): string[] {
  const f: string[] = [];
  if (h.missingExit) {
    f.push("missing_exit");
  }
  if (h.lateMinutes > 0) {
    f.push(`late:${h.lateMinutes}`);
  }
  if (h.earlyExitMinutes > 0) {
    f.push(`early:${h.earlyExitMinutes}`);
  }
  if (h.hasCorrection) {
    f.push("correction");
  }
  return f;
}
