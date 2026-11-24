// Parser das respostas ao lembrete de saída (item 5 — fluxo
// Esquecimentos do plano §6). O lembrete pergunta "Saiu às HH:MM?
// Responda SIM ou indique a hora." — este módulo decide se o texto
// confirma a hora presumida ou declara outra.
//
// Regras:
// - "SIM" e afirmativos curtos (match EXATO no texto normalizado —
//   "ainda não" ou "não saí" nunca confirmam).
// - Hora indicada: "18:05", "18h05", "18.05" ou uma hora solta
//   ("6", "saí às 6" → 18:00). A saída presume-se em hora de tarde/
//   noite: horas 1–7 passam a +12 ("6" → 18:00, "6:30" → 18:30) —
//   a alternativa (manhã) é implausível à hora do lembrete; a
//   divergência real fica POR_VALIDAR na mesma. Exceção: o zero
//   inicial ("01:15", "07") é formato 24 h inequívoco e fica como
//   está — respostas depois da meia-noite declaram madrugada.
// - Negação governa só a oração onde aparece: "não saí às 18:00" não
//   declara saída nenhuma (a hora nega a pergunta, repete-se); já
//   "não, saí às 18:20" nega a hora presumida e afirma outra — a
//   oração é separada por pontuação e a hora conta.
// - Ambíguo (duas horas distintas, texto irreconhecível) → null: o
//   handler repete a pergunta e o pending continua vivo.
// - Comandos ponto (ENTRADA/PAUSA/…) nunca chegam aqui — o handler
//   despacha-os primeiro e eles matam o pending.
//
// A hora explícita lê-se no texto CRU: a normalização troca ":" e "."
// por espaços ("18:05" → "18 05"), o que destruiria o padrão —
// a hora solta usa o texto normalizado. As orações partem-se por
// pontuação FORTE (vírgula, ponto e vírgula, "!", "?", travessão,
// fim de linha) — o "." só separa quando não está entre dígitos, para
// não partir "18.05".

import { NEGATION_WORDS, normalizePontoText } from "./commands.js";

export type PontoExitAnswer =
  | { kind: "confirmed" }
  | { hhmm: string; kind: "time" }
  | null;

const AFFIRMATIVE_WORDS = new Set([
  "afirmativo",
  "certo",
  "claro",
  "confirmo",
  "exato",
  "ok",
  "okay",
  "pois",
  "sim",
  "si",
  "ta",
  "yes",
]);

// "18:05", "18h05", "18H05", "18.05", "6:30" — no texto cru, antes da
// normalização. \b impede casar dentro de números maiores ("118:05").
const EXPLICIT_TIME_RE = /\b(\d{1,2})\s*[:hH.]\s*(\d{2})\b/g;
// Hora solta — "6", "18". Só conta quando é a única candidata.
const BARE_HOUR_RE = /\b([01]?\d|2[0-3])\b/g;
// Pontuação que fecha uma oração — o "." só quando liga dígitos fica
// ("18.05" inteiro; "18:20. Não" separa, senão a negação da segunda
// frase apagava a hora declarada na primeira).
const CLAUSE_SPLIT_RE = /[,;!?\n—–]|(?<!\d)\.|\.(?!\d)/;

/** "6" → 18, "18" → 18, "0" → 0 — saída assume-se depois do meio-dia. */
function exitHour(raw: number): number | null {
  if (!Number.isInteger(raw) || raw < 0 || raw > 23) {
    return null;
  }
  return raw >= 1 && raw <= 7 ? raw + 12 : raw;
}

function hhmmOf(
  hour: number,
  minute: number,
  zeroPadded = false
): string | null {
  if (minute > 59) {
    return null;
  }
  // Zero inicial ("01:15") é formato 24 h inequívoco — a heurística da
  // tarde só se aplica às formas ambíguas ("1:15", "6", "saí às 7").
  const h = zeroPadded ? hour : exitHour(hour);
  return h === null
    ? null
    : `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Hora escrita com zero inicial ("01:15", "07") — 24 h explícita. */
function zeroPadded(raw: string): boolean {
  return raw.length > 1 && raw.startsWith("0");
}

/** Horas:Minutos explícitas distintas no texto cru. */
function explicitTimes(raw: string): Set<string> {
  const found = new Set<string>();
  for (const m of raw.matchAll(EXPLICIT_TIME_RE)) {
    const hhmm = hhmmOf(Number(m[1]), Number(m[2]), zeroPadded(m[1]));
    if (hhmm) {
      found.add(hhmm);
    }
  }
  return found;
}

/** Horas soltas distintas no texto normalizado — "6" ou "18" a sós
 *  (guarda o texto cru para distinguir "07" de "7"). */
function bareHours(normalized: string): Set<string> {
  const hours = new Set<string>();
  for (const m of normalized.matchAll(BARE_HOUR_RE)) {
    hours.add(m[1]);
  }
  return hours;
}

/** A oração é negada ("não saí", "nunca") — a hora dentro dela nega a
 *  pergunta original em vez de declarar uma saída. */
function negated(normalizedClause: string): boolean {
  return normalizedClause.split(" ").some((t) => NEGATION_WORDS.has(t));
}

export function parsePontoExitAnswer(
  text: string | null | undefined
): PontoExitAnswer {
  if (!text) {
    return null;
  }
  // 1) Horas por oração — uma negação só descarta a hora da própria
  //    oração: "não, saí às 18:20" afirma 18:20; "não saí às 18:00,
  //    ainda estou a trabalhar" não declara nada.
  const explicit = new Set<string>();
  const bare = new Set<string>();
  for (const clause of text.split(CLAUSE_SPLIT_RE)) {
    const normalizedClause = normalizePontoText(clause);
    if (!normalizedClause || negated(normalizedClause)) {
      continue;
    }
    const times = explicitTimes(clause);
    for (const hhmm of times) {
      explicit.add(hhmm);
    }
    // Numa oração com hora explícita os dígitos soltos são os minutos
    // ("18 30") — as horas soltas só contam nas orações sem HH:MM.
    if (times.size === 0) {
      for (const h of bareHours(normalizedClause)) {
        bare.add(h);
      }
    }
  }
  if (explicit.size === 1) {
    return { hhmm: [...explicit][0], kind: "time" };
  }
  if (explicit.size > 1) {
    return null; // ambíguo — repete a pergunta
  }

  const normalized = normalizePontoText(text);
  if (!normalized) {
    return null;
  }
  // 2) Afirmativo exato — "SIM", "certo", "ta"…
  if (AFFIRMATIVE_WORDS.has(normalized)) {
    return { kind: "confirmed" };
  }
  // 3) Hora solta única — "6", "saí às 18". "entre as 18 e as 19"
  //    (duas horas) é ambíguo → repete a pergunta.
  if (bare.size === 1) {
    const raw = [...bare][0];
    const hhmm = hhmmOf(Number(raw), 0, zeroPadded(raw));
    if (hhmm) {
      return { hhmm, kind: "time" };
    }
  }
  return null;
}
