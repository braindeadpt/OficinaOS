import type {
  PontoDayHoursDTO,
  PontoEntryDTO,
  PontoEntryType,
} from "@shared/types/ponto";

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

export function formatClock(iso: string | null, locale: string): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(ymd: string, locale: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    weekday: "short",
  });
}

export function proofSummary(p: PontoEntryDTO["proofs"]): string[] {
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
    out.push("code!");
  }
  if (p.hasPhoto || p.photoId) {
    out.push("photo");
  }
  if (p.manual) {
    out.push("manual");
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
