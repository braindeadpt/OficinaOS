// REGISTOS — direito de acesso (art. 15.º RGPD) no livro de ponto.
//
// O trabalhador pede os próprios registos pelo mesmo canal que usa para
// picar (WhatsApp/SMS). A resposta é um resumo do mês mais um link para o
// PDF servido pela app: token de uso único, válido 24 h, guardado só como
// hash. O PDF nunca passa pela Cloud — a mensagem leva apenas o endereço.
//
// Identidade: o telefone já é a prova — só chega aqui quem o handler
// resolveu como staff com pontoEnabled e phoneE164 (findPontoStaff), por
// isso um trabalhador nunca recebe registos de outro e um número
// desconhecido nem sequer dispara o comando.

import { createHash, randomBytes } from "node:crypto";
import type { DbClient } from "../../repositories/types.js";
import { zonedDateTimeToUtc } from "../../utils/time-range.js";

const REGISTOS_DAILY_LIMIT = 5;
const MONTH_NUM_RE = /^\d{1,2}$/;
const YEAR_NUM_RE = /^\d{4}$/;
const DIGITS_RE = /^\d+$/;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface MonthSpec {
  month: number; // 1-12
  year: number;
}

/** Etiqueta yyyy-mm gravada no token e usada na query. */
export function monthKey(spec: MonthSpec): string {
  return `${spec.year}-${String(spec.month).padStart(2, "0")}`;
}

/** Mês corrente no fuso da loja. */
export function currentMonthSpec(tz: string, now = new Date()): MonthSpec {
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "numeric",
    timeZone: tz,
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { month: get("month"), year: get("year") };
}

/**
 * Interpreta «REGISTOS 10/2026» no texto normalizado («registos 10 2026»).
 * Devolve null quando não há mês no texto (usa-se o corrente) e undefined
 * quando o mês é inválido ou futuro — o handler responde com erro claro.
 */
/** Há texto que parece uma data malformada? — ano de 4 dígitos sem mês
 * válido («abc 2026»), dois números seguidos sem ano de 4 dígitos
 * («10/26»), ou um mês sozinho sem ano («REGISTOS 10»). */
function looksLikeMalformedDate(tokens: string[]): boolean {
  if (tokens.some((t) => YEAR_NUM_RE.test(t))) {
    return true;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (DIGITS_RE.test(tokens[i]) && DIGITS_RE.test(tokens[i + 1])) {
      return true;
    }
  }
  return tokens.length === 2 && MONTH_NUM_RE.test(tokens[1]);
}

export function parseMonthArg(
  normalizedText: string,
  tz: string,
  now = new Date()
): MonthSpec | null | undefined {
  // O par mês/ano procura-se em qualquer posição: o parser de comandos é
  // tolerante a gralhas («REGSITOS»), e procurar só depois da palavra
  // exata ignorava o mês nesses pedidos — o trabalhador recebia o mês
  // errado sem aviso.
  const tokens = normalizedText.split(" ");
  let mm: string | undefined;
  let yyyy: string | undefined;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (MONTH_NUM_RE.test(tokens[i]) && YEAR_NUM_RE.test(tokens[i + 1])) {
      mm = tokens[i];
      yyyy = tokens[i + 1];
      break;
    }
  }
  if (!(mm && yyyy)) {
    // Erro claro — nunca o mês errado em silêncio — quando há texto de
    // data malformado: um ano de 4 dígitos sem mês válido («abc 2026»)
    // ou dois números seguidos sem ano de 4 dígitos («10/26» vira «10 26»).
    if (looksLikeMalformedDate(tokens)) {
      return;
    }
    return null;
  }
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12) {
    return;
  }
  const cur = currentMonthSpec(tz, now);
  if (year > cur.year || (year === cur.year && month > cur.month)) {
    return;
  }
  return { month, year };
}

/** Intervalo UTC do mês civil no fuso da loja. */
export function monthSpecRange(
  tz: string,
  spec: MonthSpec
): { end: Date; start: Date } {
  const ymd = `${spec.year}-${String(spec.month).padStart(2, "0")}-01`;
  const start = zonedDateTimeToUtc(tz, ymd, "00:00");
  const next =
    spec.month === 12
      ? { month: 1, year: spec.year + 1 }
      : { month: spec.month + 1, year: spec.year };
  const endYmd = `${next.year}-${String(next.month).padStart(2, "0")}-01`;
  const end = zonedDateTimeToUtc(tz, endYmd, "00:00");
  if (!(start && end)) {
    throw new Error(`fuso horário inválido: ${tz}`);
  }
  return { end, start };
}

export interface RegistosEntry {
  at: Date;
  status: string;
  /** Linha substituída por uma correção — não conta para os totais. */
  superseded: boolean;
  type: string;
  validations: { decision: string }[];
}

/** Linhas do mês para o resumo e o PDF — inclui correções para a contagem. */
export async function registosMonthEntries(
  prisma: DbClient,
  userId: string,
  tz: string,
  spec: MonthSpec
): Promise<{
  correctionsCount: number;
  effectiveEntries: RegistosEntry[];
  entries: RegistosEntry[];
}> {
  const { end, start } = monthSpecRange(tz, spec);
  const rows = await prisma.timeEntry.findMany({
    orderBy: [{ at: "asc" }, { createdAt: "asc" }],
    select: {
      at: true,
      corrections: { select: { id: true }, take: 1 },
      status: true,
      type: true,
      validations: {
        orderBy: { at: "desc" },
        select: { decision: true },
        take: 1,
      },
    },
    where: { at: { gte: start, lt: end }, userId },
  });
  // Correções contam-se pelas linhas substituídas (têm correção apontada).
  const correctionsCount = rows.filter((r) => r.corrections.length > 0).length;
  // Horas e pendências só com marcações efetivas: nem substituídas pela
  // correção nem recusadas pela validação mais recente — como o ESTADO.
  const effective = rows.filter(
    (r) =>
      r.corrections.length === 0 && r.validations[0]?.decision !== "RECUSADO"
  );
  const map = (r: (typeof rows)[number]) => ({
    at: r.at,
    status: r.status,
    superseded: r.corrections.length > 0,
    type: r.type,
    validations: r.validations,
  });
  // Direito de acesso: o PDF lista TODAS as marcações do próprio —
  // recusadas e substituídas incluídas, são registos dele. Os totais do
  // resumo é que usam só as efetivas (como o ESTADO).
  return {
    correctionsCount,
    effectiveEntries: effective.map(map),
    entries: rows.map(map),
  };
}

export interface MonthSummary {
  correctionsCount: number;
  days: number;
  entriesCount: number;
  pauseMs: number;
  pendingCount: number;
  workedMs: number;
}

function dayKeyOf(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
}

/** Tempo de trabalho: segmentos ENTRADA/VOLTEI → PAUSA/SAIDA. Um turno
 * ainda aberto conta até à hora do pedido — mas só se o turno for de
 * hoje: estender um esquecimento antigo até agora somava noites e dias
 * como tempo trabalhado. */
function workMsOfDay(list: RegistosEntry[], now: Date, tz: string): number {
  let total = 0;
  let open: Date | null = null;
  for (const e of list) {
    if (e.type === "ENTRADA" || e.type === "VOLTEI") {
      open = open ?? e.at;
    } else if ((e.type === "PAUSA" || e.type === "SAIDA") && open) {
      total += e.at.getTime() - open.getTime();
      open = null;
    }
  }
  if (open) {
    if (dayKeyOf(open, tz) === dayKeyOf(now, tz)) {
      total += now.getTime() - open.getTime();
    } else {
      // Esquecimento de um dia passado: o painel conta até à meia-noite
      // desse dia — o resumo mensal tem de bater certo com ele.
      const [y, m, d] = dayKeyOf(open, tz).split("-").map(Number);
      const nextYmd = new Date(Date.UTC(y, m - 1, d + 1))
        .toISOString()
        .slice(0, 10);
      const midnight = zonedDateTimeToUtc(tz, nextYmd, "00:00");
      if (midnight) {
        total += midnight.getTime() - open.getTime();
      }
    }
  }
  return total;
}

/** Tempo de pausa: segmentos PAUSA → VOLTEI. */
function pauseMsOfDay(list: RegistosEntry[]): number {
  let total = 0;
  let open: Date | null = null;
  for (const e of list) {
    if (e.type === "PAUSA") {
      open = open ?? e.at;
    } else if (e.type === "VOLTEI" && open) {
      total += e.at.getTime() - open.getTime();
      open = null;
    }
  }
  return total;
}

function sumDayEntries(
  list: RegistosEntry[],
  now: Date,
  tz: string
): {
  pauseMs: number;
  pendingCount: number;
  workedMs: number;
} {
  const pendingCount = list.filter(
    (e) => e.status === "POR_VALIDAR" && e.validations.length === 0
  ).length;
  return {
    pauseMs: pauseMsOfDay(list),
    pendingCount,
    workedMs: workMsOfDay(list, now, tz),
  };
}

/** Pares ENTRADA→(PAUSA→VOLTEI)→SAIDA por dia civil, como o painel. */
export function summarizeMonth(
  entries: RegistosEntry[],
  correctionsCount: number,
  tz: string,
  now: Date = new Date()
): MonthSummary {
  const byDay = new Map<string, RegistosEntry[]>();
  for (const e of entries) {
    const key = dayKeyOf(e.at, tz);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }
  let workedMsTotal = 0;
  let pauseMsTotal = 0;
  let pendingCount = 0;
  for (const list of byDay.values()) {
    const day = sumDayEntries(list, now, tz);
    workedMsTotal += day.workedMs;
    pauseMsTotal += day.pauseMs;
    pendingCount += day.pendingCount;
  }
  return {
    correctionsCount,
    days: byDay.size,
    entriesCount: entries.length,
    pauseMs: pauseMsTotal,
    pendingCount,
    workedMs: workedMsTotal,
  };
}

export function fmtHoursMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Rate limit persistente: 5 pedidos por dia civil UTC por trabalhador. */
export async function registosRateOk(
  prisma: DbClient,
  userId: string,
  now = new Date()
): Promise<boolean> {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const count = await prisma.pontoRegistosToken.count({
    where: { createdAt: { gte: dayStart }, userId },
  });
  return count < REGISTOS_DAILY_LIMIT;
}

export async function createRegistosToken(
  prisma: DbClient,
  userId: string,
  month: string
): Promise<string> {
  const plaintext = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");
  await prisma.pontoRegistosToken.create({
    data: {
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      month,
      tokenHash,
      userId,
    },
  });
  return plaintext;
}

/** Validez sem consumir — para o HEAD das pré-visualizações. */
export async function peekRegistosToken(
  prisma: DbClient,
  plaintext: string
): Promise<boolean> {
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");
  const row = await prisma.pontoRegistosToken.findUnique({
    where: { tokenHash },
  });
  return Boolean(row && !row.usedAt && row.expiresAt >= new Date());
}

/** Consome o token: uso único — a marcação é atómica (count 0 = já usado). */
export async function consumeRegistosToken(
  prisma: DbClient,
  plaintext: string
): Promise<{ month: string; userId: string } | null> {
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");
  const row = await prisma.pontoRegistosToken.findUnique({
    where: { tokenHash },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return null;
  }
  const consumed = await prisma.pontoRegistosToken.updateMany({
    data: { usedAt: new Date() },
    where: { id: row.id, usedAt: null },
  });
  if (consumed.count !== 1) {
    return null;
  }
  return { month: row.month, userId: row.userId };
}
