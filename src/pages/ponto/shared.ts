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

/** Dia + hora — listas multi-dia (decisões recentes) onde a hora
 *  sozinha tornava duas picagens iguais em dias diferentes
 *  indistinguíveis. */
export function formatDayClock(
  iso: string | null,
  locale: string,
  timeZone?: string
): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
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

function wallTimeParts(
  ymd: string,
  hhmm: string
): {
  d: number;
  h: number;
  mi: number;
  mo: number;
  targetUtc: number;
  y: number;
} | null {
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
  return { d, h, mi, mo, targetUtc: Date.UTC(y, mo - 1, d, h, mi, 0), y };
}

/**
 * Todos os instantes UTC cuja leitura NO FUSO DA LOJA é "YYYY-MM-DD
 * HH:MM", por ordem cronológica. Na mudança para a hora de inverno a
 * mesma hora de parede acontece duas vezes com desvios UTC diferentes
 * (devolve [2]); na mudança para o verão há horas que não existem
 * (devolve []). Uma hora normal devolve um único candidato — e um
 * datetime-local inválido devolve [] tal como uma data válida.
 */
export function shopWallTimeCandidates(
  tz: string,
  ymd: string,
  hhmm: string
): Date[] {
  const w = wallTimeParts(ymd, hhmm);
  if (!w) {
    return [];
  }
  // Um instante com a leitura pedida está a |desvio UTC| ≤ 14h do alvo.
  // Varrem-se os desvios em vigor numa janela de ±15h (amostras de 15
  // min — cada desvio dura semanas, não falha nenhum) e verifica-se
  // quais reproduzem a hora de parede.
  const offsets = new Set<number>();
  for (
    let probe = w.targetUtc - 15 * 3_600_000;
    probe <= w.targetUtc + 15 * 3_600_000;
    probe += 15 * 60_000
  ) {
    const p = zonedParts(tz, new Date(probe));
    offsets.add(
      probe - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0)
    );
  }
  const matches: Date[] = [];
  for (const offsetMs of offsets) {
    const candidate = new Date(w.targetUtc + offsetMs);
    const cp = zonedParts(tz, candidate);
    if (
      cp.year === w.y &&
      cp.month === w.mo &&
      cp.day === w.d &&
      cp.hour === w.h &&
      cp.minute === w.mi
    ) {
      matches.push(candidate);
    }
  }
  return matches.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Converte "YYYY-MM-DD" + "HH:MM" lidos NO FUSO DA LOJA num instante UTC.
 * O input datetime-local devolve hora de parede — interpretá-la no fuso
 * do dispositivo gravava a saída no dia errado (o caso dos Açores/Lisboa).
 * Devolve a ocorrência mais cedo (ver shopWallTimeCandidates para a hora
 * repetida na mudança para a hora de inverno) ou null se os argumentos
 * não formarem uma data/hora que exista na loja.
 */
export function shopWallTimeToUtc(
  tz: string,
  ymd: string,
  hhmm: string
): Date | null {
  return shopWallTimeCandidates(tz, ymd, hhmm)[0] ?? null;
}

/**
 * "UTC±HH:MM" do desvio em vigor num instante — etiqueta das ocorrências
 * quando a mesma hora de parede acontece duas vezes (mudança de hora).
 */
export function shopUtcOffsetLabel(tz: string, d: Date): string {
  const p = zonedParts(tz, d);
  const offsetMin = Math.round(
    (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - d.getTime()) /
      60_000
  );
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
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
  if (p.hasPhoto && !p.photoSentAt) {
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
