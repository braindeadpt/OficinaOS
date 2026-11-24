// Parser das respostas ao lembrete de saída (item 5 — fluxo
// Esquecimentos do plano §6). O lembrete pergunta "Saiu às HH:MM?
// Responda SIM ou indique a hora." — este módulo decide se o texto
// confirma a hora presumida ou declara outra.
//
// Regras:
// - "SIM" e afirmativos curtos (match EXATO no texto normalizado —
//   "ainda não" ou "não saí" nunca confirmam).
// - Hora indicada: "18:05", "18h05", "18.05" (também "18. 30") ou
//   uma hora solta
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
// fim de linha) — o "." só separa quando não pode ser o separador
// Horas.minutos ("18.05", "18. 30" inteiros; "18:20. Não" separa).
// Exceção: os dois dígitos a seguir introduzem uma DURAÇÃO ("18. 20
// minutos antes de fecharem") — aí o ponto é fim de frase: senão
// "18. 20" lia-se como 18:20 em vez de 18:00 + duração.

import { NEGATION_WORDS, normalizePontoText } from "./commands.js";

export type PontoExitAnswer =
  | { kind: "ambiguous" }
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
// Quantidade de duração — "15 minutos", "2 mins", "30 segundos" — não
// é hora solta ("Saí às 18. 15 minutos depois" não declara as 15:00).
// «horas»/«hrs» ficam de fora de propósito: «às 18 horas» = 18:00.
const DURATION_QTY_RE = /\b\d{1,3}\s*(?:minutos?|mins?|segundos?|segs?)\b/gi;
// Duração relativa por extenso — «há 2 horas», «faz 1 hora e 30
// minutos»: aqui o número antes de «horas» é quantidade e não hora do
// relógio («saí há 2 horas e 15 minutos» não é saída às 14:00). A
// frase sai inteira — a conjunção e a 2.ª quantidade incluídas — antes
// de se procurarem horas por extenso ou soltas.
const RELATIVE_DURATION_RE =
  /\b(?:ha|faz)\s+\d{1,3}\s*(?:horas?|hrs?|minutos?|mins?|segundos?|segs?)(?:\s+e\s+\d{1,3}\s*(?:horas?|hrs?|minutos?|mins?|segundos?|segs?))*\b/gi;
// Duração composta sem «há/faz» nem «às» — «trabalhei 8 horas e 30
// minutos», «fiquei 2 horas e meia»: não é hora por extenso (falta o
// «às») e a parte das «horas» não pode virar hora solta (20:00 por
// engano). A frase sai inteira antes das horas soltas.
const COMPOUND_DURATION_RE =
  /\b\d{1,3}\s*horas?\s+e\s+(?:\d{1,3}\s*(?:minutos?|mins?)?|meia)\b/gi;
// Hora por extenso — «às 18 horas e 15 minutos» = 18:15, «às 6 horas
// e 30» = 18:30, «às 6 horas e meia» = 18:30, «pelas 8 horas e 15
// da noite» = 20:15 («e» liga os minutos à hora; sem «e» fica «18
// horas» como hora solta = 18:00). Marcador obrigatório — «trabalhei
// 8 horas e 30 minutos» é duração (COMPOUND_DURATION_RE), não 20:30.
// O «à» com acento é reescrito para «ás» antes da normalização —
// continua a marcar; o «a» conector de intervalo («de 1 a 2 horas
// e meia») não é marcador. Dígitos antes do marcador não o bloqueiam:
// «dia 17 às 6 horas e meia» é uma data seguida da hora — as horas
// compactas saem do texto normalizado, por isso um «as» a seguir a
// «18:05» nunca aparece lá. Minutos — com ou sem unidade — não podem
// ser a cabeça de outra duração: «às 18 horas e 1 hora depois»,
// «às 18 horas e 1 hora atrás» e «às 18 horas e 15 minutos depois»
// não são 18:01/18:15 — a leitura fica ambígua e a pergunta
// repete-se. «mais» corta sempre («15 minutos mais cedo/tarde» é
// duração, não a hora 18:15) — a única exceção é «mais ou menos»
// (aproximado).
const EXTENSO_TIME_RE =
  /\b(?:as|pelas?)\s+(\d{1,2})\s+horas?\s+e\s+(?:(\d{1,2})\s*(?:minutos?|mins?)\b|(\d{1,2})(?!\s+(?:horas?|hrs?|minutos?|mins?|segundos?|segs?|dias?|semanas?|meses?|anos?|depois|apos|antes|atras)\b)|meia)\b(?!\s+(?:depois|apos|antes|atras|seguida|mais(?!\s+ou\s+menos))\b)(?:\s+da\s+(manha|tarde|noite)\b)?/gi;
// «pelas 8 horas da noite» = 20:00 — período sem «e N minutos».
const QUALIFIED_HOUR_RE =
  /\b(?:as|pelas?)\s+(\d{1,2})\s+horas?\s+da\s+(manha|tarde|noite)\b/gi;
// Pontuação que fecha uma oração — o "." fica quando pode ser o
// separador Horas.minutos de EXPLICIT_TIME_RE. Junto a dígitos a
// notação compacta ganha sempre ("18.30", "18. 30", "18 . 30" —
// mesmo seguida de «horas»: "18.30 horas" = 18:30); o "." só separa
// quando fecha uma frase ("18:20. Não" — senão a negação da segunda
// frase apagava a hora declarada na primeira) ou quando um ESPAÇO o
// afasta dos dígitos que quantificam uma duração ("Saí às 18. 20
// minutos antes" = saída às 18:00 — não 18:20).
const CLAUSE_SPLIT_RE =
  /[,;!?\n—–]|(?<!\d\s*)\.|\.(?!\d{2})(?!\s+\d{2}\b(?!\s+(?:minutos?|mins?|horas?|hrs?|segundos?|segs?)\b))/i;

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

// Referência de data — «dia 5», «12 de julho», «semana 42»: o número
// pertence ao calendário, não é hora solta.
const DATE_REF_RE =
  /\b(?:\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|(?:dias?|mes(?:es)?|anos?|semanas?)\s+\d{1,4})\b/gi;
// Data com barras/hífens — «23/11», «23/11/2026», «23-11»: sai do
// texto cru antes da normalização («/» e «-» viram espaços e os
// números fingiam ser horas soltas). O «.» fica de fora de propósito
// — colidiria com as horas compactas («18.30»).
const DATE_SLASH_RE = /\b\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?\b/g;
// Intervalo «de 7 a 8 horas» — os dois números são as pontas duma
// duração ou faixa («de 1 a 2 horas e meia»), não horas soltas.
const RANGE_QTY_RE = /\b\d{1,3}\s+a\s+\d{1,3}\b/gi;
// Quantidade de horas com contexto de duração — «depois de
// trabalhar 8 horas», «fiquei mais de 2 horas», «depois de 8
// horas»: o verbo ou o marcador temporal à frente mede o tempo
// passado, não a hora de saída. Sem esse contexto, «às 8 horas»
// continua hora do relógio («ou às 19 horas» fica ambíguo).
const WORKED_DURATION_RE =
  /\b(?:depois|apos|antes|trabalhei|trabalhar|trabalhou|trabalhava|trabalhando|estive|esteve|fiz|fez|fiquei|ficou|aguardei|esperei|levei|levou|demorei|demorou|completei|passei|passou|durei|durou)\s+(?:(?:mais\s+de|de|das?|a|as|cerca\s+de|quase|perto\s+de|por|umas?|ao\s+todo|no\s+total)\s+)*\d{1,3}\s*horas?\b/gi;

/** Horas soltas distintas no texto normalizado — "6" ou "18" a sós
 *  (guarda o texto cru para distinguir "07" de "7"). Quantidades de
 *  duração, datas e intervalos «N a N» saem antes: "15 minutos
 *  depois" não é a hora 15, "no dia 5" não é a hora 17, "de 7 a 8
 *  horas" não são as horas 19 e 20 e «trabalhar 8 horas» não é a
 *  hora 8. */
function bareHours(normalized: string): Set<string> {
  const hours = new Set<string>();
  const withoutDurations = normalized
    .replace(RANGE_QTY_RE, " ")
    .replace(WORKED_DURATION_RE, " ")
    .replace(COMPOUND_DURATION_RE, " ")
    .replace(DURATION_QTY_RE, " ")
    .replace(DATE_REF_RE, " ");
  for (const m of withoutDurations.matchAll(BARE_HOUR_RE)) {
    hours.add(m[1]);
  }
  return hours;
}

/** «da manhã»/«da tarde»/«da noite» sobrepõe-se à heurística da
 *  tarde: «8 da noite» = 20, «1 da manhã» = 01. O zero já vem em
 *  formato 24 h e «12 da noite» é meia-noite — nenhum soma 12 («00
 *  horas e 15 da noite» = 00:15, não 12:15). Qualificador
 *  impossível («18 da manhã») devolve null — leitura ambígua. */
function hourWithPeriod(hour: number, period: string): number | null {
  if (period === "manha") {
    return hour >= 0 && hour <= 12 ? hour : null;
  }
  if (hour === 0 || (period === "noite" && hour === 12)) {
    return 0;
  }
  return hour < 12 ? hour + 12 : hour;
}

/** A oração é negada ("não saí", "nunca") — a hora dentro dela nega a
 *  pergunta original em vez de declarar uma saída. */
function negated(normalizedClause: string): boolean {
  return normalizedClause.split(" ").some((t) => NEGATION_WORDS.has(t));
}

/** Junta os candidatos da oração às coleções — explícita (HH:MM ou
 *  por extenso) ou horas soltas. Durações relativas saem primeiro —
 *  «há 2 horas e 15 minutos» não é a hora «14:15»; o que sobra pode
 *  trazer a hora por extenso («às 18 horas e 15 minutos» = 18:15). */
function collectClause(
  clause: string,
  explicit: Set<string>,
  bare: Set<string>
): void {
  // «à» com acento marca hora como «às» — reescreve-se para «ás» no
  // texto cru (a normalização apagava a diferença) para o separar do
  // «a» conector de intervalo («de 1 a 2 horas e meia»), que não é
  // marcador de hora. O NFC primeiro garante que «à» serve nas duas
  // codificações (carácter único ou «a» + acento combinante). As
  // horas compactas e as datas com «/»/«-» saem do texto a
  // normalizar — os dígitos delas («18:05» → «18 05», «23/11» →
  // «23 11») não são horas soltas nem abrem extenso novo.
  const normalizedClause = normalizePontoText(
    clause
      .normalize("NFC")
      .replace(/à(?=\s*\d)/gi, "ás")
      .replace(DATE_SLASH_RE, " ")
      .replace(EXPLICIT_TIME_RE, " ")
  );
  // Sem texto restante (a oração era só a hora compacta, «18h30»)
  // segue-se na mesma — a negação precisa de palavras.
  if (negated(normalizedClause)) {
    return;
  }
  const times = explicitTimes(clause);
  const withoutRelatives = normalizedClause.replace(RELATIVE_DURATION_RE, " ");
  // Qualificador impossível («às 18 horas da manhã»): a oração não
  // baixa para horas soltas — fica ambígua e a pergunta repete-se.
  let spelledInvalid = false;
  const addSpelled = (
    hourRaw: string,
    minute: number,
    period: string | undefined
  ): void => {
    if (minute > 59) {
      return;
    }
    const hour = Number(hourRaw);
    if (period === undefined) {
      const hhmm = hhmmOf(hour, minute, zeroPadded(hourRaw));
      if (hhmm) {
        times.add(hhmm);
      }
      return;
    }
    const h = hourWithPeriod(hour, period);
    if (h === null || h > 23) {
      spelledInvalid = true;
      return;
    }
    times.add(
      `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    );
  };
  for (const m of withoutRelatives.matchAll(EXTENSO_TIME_RE)) {
    const minutes = m[2] ?? m[3];
    addSpelled(m[1], minutes === undefined ? 30 : Number(minutes), m[4]);
  }
  for (const m of withoutRelatives.matchAll(QUALIFIED_HOUR_RE)) {
    addSpelled(m[1], 0, m[2]);
  }
  for (const hhmm of times) {
    explicit.add(hhmm);
  }
  // Numa oração com hora explícita os dígitos soltos são os minutos
  // ("18 30") — as horas soltas só contam nas orações sem HH:MM e sem
  // qualificador impossível («às 18 horas da manhã» é ambígua, não
  // baixa para «18» solto).
  if (times.size === 0 && !spelledInvalid) {
    for (const h of bareHours(withoutRelatives)) {
      bare.add(h);
    }
  } else if (times.size > 0) {
    // ...mas uma oração com hora reconhecida pode trazer OUTRA hora
    // numa alternativa ou intervalo — «entre as 7 e as 8 horas da
    // noite», «às 8 horas da noite ou às 21». O que sobra depois de
    // tirar as horas já lidas e as durações é candidato também:
    // duas horas na resposta = ambíguo (repete-se a pergunta).
    const withoutSpelled = withoutRelatives
      .replace(EXTENSO_TIME_RE, " ")
      .replace(QUALIFIED_HOUR_RE, " ");
    for (const h of bareHours(withoutSpelled)) {
      const hhmm = hhmmOf(Number(h), 0, zeroPadded(h));
      if (hhmm) {
        explicit.add(hhmm);
      }
    }
  }
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
    collectClause(clause, explicit, bare);
  }
  if (explicit.size === 1) {
    return { hhmm: [...explicit][0], kind: "time" };
  }
  if (explicit.size > 1) {
    // Ambíguo — duas ou mais horas declaradas. O handler repete a
    // pergunta sem gravar; a distinção de «sem hora» (null) serve
    // para a rota de comandos não engolir a resposta (SAÍDA com
    // horas em conflito não pode gravar a hora de receção).
    return { kind: "ambiguous" };
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
  if (bare.size > 1) {
    return { kind: "ambiguous" };
  }
  return null;
}
