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
  | {
      /** Data declarada na resposta («23/11») — se existir, tem de
       *  bater num dos dias candidatos do turno; sem coincidência o
       *  handler repete a pergunta em vez de gravar no dia errado. */
      date?: { day: number; month: number; year: number | null };
      hhmm: string;
      kind: "time";
    }
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
// Os olhares laterais impedem comer a ponta dum intervalo horário —
// «18:00-19» não é a data «00-19» nem «18-19:30» a data «18-19»: a
// frase fica inteira e as duas horas tornam a resposta ambígua. Os
// grupos capturados servem para devolver a data declarada na
// resposta.
// A forma ISO «2026-01-10» casa primeiro — senão o sufixo «01-10»
// lia-se como 1 de outubro. À direita só bloqueia um separador que
// forme hora («:30», «.30»): dois-pontos ou ponto a introduzir texto
// («10/1: saí às 18:05», «10/1. Foi isso») não escondem a data.
const DATE_SLASH_RE =
  /(?<![\d:.])\b(?:(\d{4})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{1,2})|(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?)\b(?!\d|[:/.]\s*\d)/g;
// Intervalo «de 7 a 8 horas» — os dois números são as pontas duma
// duração ou faixa («de 1 a 2 horas e meia»), não horas soltas.
const RANGE_QTY_RE = /\b\d{1,3}\s+a\s+\d{1,3}\b/gi;
// Quantidade de horas com contexto de duração — «depois de
// trabalhar 8 horas», «fiquei mais de 2 horas», «depois de 8
// horas»: o verbo ou o marcador temporal à frente mede o tempo
// passado, não a hora de saída. As preposições admitidas são só
// as de quantidade — «das»/«às»/«a» marcam hora do relógio:
// «depois das 19 horas» é um limite de hora, não uma duração, e
// não sai do texto. Sem esse contexto, «às 8 horas» continua hora
// do relógio («ou às 19 horas» fica ambíguo).
const WORKED_DURATION_RE =
  /\b(?:depois|apos|antes|trabalhei|trabalhar|trabalhou|trabalhava|trabalhando|estive|esteve|fiz|fez|fiquei|ficou|aguardei|esperei|levei|levou|demorei|demorou|completei|passei|passou|durei|durou)\s+(?:(?:mais\s+de|de|cerca\s+de|quase|perto\s+de|por|umas?|ao\s+todo|no\s+total)\s+)*\d{1,3}\s*horas?\b/gi;
// Limite de hora — «depois das 19 horas», «antes das 8», «até às
// duas», «depois das 18 horas e meia»: o trabalhador diz que saiu
// DEPOIS/ANTES dessa hora, não a essa hora — sozinho não é
// resposta válida. Mas conta para a ambiguidade: «18:05 ou depois
// das 19 horas» tem duas candidatas. Os minutos por extenso («e
// meia», «e 30», «e 15 minutos») fazem parte do limite — «depois
// das 18 horas e meia» é 18:30, não 18:00; dígitos seguidos de
// unidade de duração não são minutos («depois das 18 horas e 1
// hora depois»).
const BOUND_HOUR_RE =
  /\b(depois|apos|antes|ate)\s+(?:das?|as)\s+(\d{1,2})\s*horas?(?:\s+e\s+(?:(\d{1,2})\s*(?:minutos?|mins?)\b(?!\s+(?:depois|apos|antes|atras|seguida|mais(?!\s+ou\s+menos)))|(\d{1,2})(?!\s+(?:horas?|hrs?|minutos?|mins?|segundos?|segs?|depois|apos|antes|atras|seguida|mais(?!\s+ou\s+menos))\b)|(meia)(?!\s+horas?\b))\b)?(?:\s+da\s+(manha|tarde|noite)\b)?/gi;
// A oração volta a afirmar a saída — o limite descreve-a, não
// outro acontecimento: «ou saí depois das 19» é alternativa mesmo
// depois dum contexto de turno. Só formas afirmadas. Na 1.ª
// pessoa basta a forma: «saímos» e o auxiliar aspectual («acabei
// por sair», «terminei por sair», «consegui sair», «voltei a
// sair», «fui sair»). O infinito solto («autorização para sair
// depois das 17», «podia sair») e o imperfeito «saía» são
// permissão ou horário, não a saída de hoje.
const CLAIMS_EXIT_1ST_RE =
  /\bsaimos\b|\b(?:acabei|terminei|cheguei|consegui|voltei|fui)\s+(?:por\s+|a\s+|de\s+)?sair\b/i;
// Formas ambíguas ou na 3.ª pessoa («sai», «saiu», «a saída foi»,
// «saindo», «acabou por sair») só afirmam a saída do trabalhador
// com referência a si («eu», «a minha saída») ou quando a oração
// não nomeia outro sujeito — «o meu colega saiu depois das 19»
// ou «a encomenda saiu depois das 19» são contexto, não correção.
const CLAIMS_EXIT_3RD_RE =
  /\bsai(?:u|d[ao]|ndo)?\b|\b(?:acabou|terminou|chegou)\s+(?:por\s+|a\s+|de\s+)?sair\b/i;
const THIRD_PERSON_RE =
  /\b(?:colegas?|ele|ela|eles|elas|encomendas?|pedidos?|clientes?|chefe|patrao|gerente|motorista|autocarro|comboio)\b/;
const SELF_EXIT_RE = /\b(?:eu|minh[ao]s?)\b/;
// Reformulação «ou seja …» no fim do texto antes do limite.
const OU_SEJA_END_RE = /(?:^|\s)ou\s+seja$/;
// «ou» a ligar o limite à hora, com advérbios comuns pelo meio —
// «ou só depois das 19», «ou talvez mesmo depois das 19».
const OU_LINK_END_RE =
  /(?:^|\s)ou(?:\s+(?:so|talvez|mesmo|ainda|apenas|logo|afinal|tambem|nem))*$/;
// Negação no texto cru — a data antes dela («a 9/1 não sei a hora
// ao certo») não está anulada, está incerta; a data depois dela
// («não foi a 9/1») é a negada.
const NEGATION_START_RE = /\b(?:n[aã]o|nunca|jamais)\b/i;

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
    // Compostas antes das simples — «trabalhar 8 horas e 15» é uma
    // duração só: tirar «8 horas» primeiro deixava o «15» como hora.
    .replace(COMPOUND_DURATION_RE, " ")
    .replace(WORKED_DURATION_RE, " ")
    .replace(BOUND_HOUR_RE, " ")
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

/** Junta as horas por extenso da oração ao conjunto — «às 18 horas
 *  e 15 minutos», «pelas 8 horas da noite». Devolve true quando um
 *  qualificador é impossível («às 18 horas da manhã»): a oração não
 *  baixa para horas soltas — fica ambígua e a pergunta repete-se. */
function collectSpelledTimes(
  withoutRelatives: string,
  times: Set<string>
): boolean {
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
  return spelledInvalid;
}

/** Junta à oração as horas declaradas — compactas (EXPLICIT), por
 *  extenso com «às»/«pelas» (spelled) e soltas (bare) — e devolve
 *  "new" quando traz uma hora ainda não declarada, "repeat" quando só
 *  repete horas já ditas e "none" quando não declara nenhuma: repetir
 *  «18» noutra oração é mero contexto («às 18 a loja estava aberta
 *  até às 19»), salvo se o «ou» ligar o limite como alternativa
 *  («talvez às 18 ou depois das 19»). */
function collectClauseHours(
  clause: string,
  withoutRelatives: string,
  explicit: Set<string>,
  bare: Set<string>
): "new" | "repeat" | "none" {
  const times = explicitTimes(clause);
  const spelledInvalid = collectSpelledTimes(withoutRelatives, times);
  // «18:00» e «18» declaram a mesma hora — a hora só é «nova» quando
  // não foi declarada em nenhum dos dois formatos. A comparação faz-se
  // com a hora solta JÁ interpretada («7» é 19:00; só «07» é 07:00) —
  // senão «às 7» e «07:00» fundiam-se na mesma declaração.
  const seenExplicit = (hhmm: string): boolean =>
    explicit.has(hhmm) ||
    [...bare].some((b) => hhmmOf(Number(b), 0, zeroPadded(b)) === hhmm);
  const seenBare = (h: string): boolean =>
    bare.has(h) || explicit.has(hhmmOf(Number(h), 0, zeroPadded(h)) ?? "\0");
  let sawHour = false;
  let clauseHasNewHour = false;
  for (const hhmm of times) {
    sawHour = true;
    if (!seenExplicit(hhmm)) {
      clauseHasNewHour = true;
    }
    explicit.add(hhmm);
  }
  // Numa oração com hora explícita os dígitos soltos são os minutos
  // ("18 30") — as horas soltas só contam nas orações sem HH:MM e sem
  // qualificador impossível («às 18 horas da manhã» é ambígua, não
  // baixa para «18» solto).
  if (times.size === 0 && !spelledInvalid) {
    for (const h of bareHours(withoutRelatives)) {
      sawHour = true;
      if (!seenBare(h)) {
        clauseHasNewHour = true;
      }
      bare.add(h);
    }
  } else if (times.size > 0) {
    // ...mas uma oração com hora reconhecida pode trazer OUTRA hora
    // numa alternativa ou intervalo — «entre as 7 e as 8 horas da
    // noite», «às 8 horas da noite ou às 21». O que sobra depois de
    // tirar as horas já lidas e as durações é candidato também:
    // duas horas na resposta = ambíguo (repete-se a pergunta).
    for (const hhmm of extraBareAsExplicit(withoutRelatives)) {
      sawHour = true;
      if (!seenExplicit(hhmm)) {
        clauseHasNewHour = true;
      }
      explicit.add(hhmm);
    }
  }
  if (clauseHasNewHour) {
    return "new";
  }
  return sawHour ? "repeat" : "none";
}

/** Horas soltas convertidas a HH:MM numa oração que já tem hora
 *  reconhecida — sem as lidas por extenso nem as durações. */
function extraBareAsExplicit(withoutRelatives: string): Set<string> {
  const withoutSpelled = withoutRelatives
    .replace(EXTENSO_TIME_RE, " ")
    .replace(QUALIFIED_HOUR_RE, " ");
  const found = new Set<string>();
  for (const h of bareHours(withoutSpelled)) {
    const hhmm = hhmmOf(Number(h), 0, zeroPadded(h));
    if (hhmm) {
      found.add(hhmm);
    }
  }
  return found;
}

/** Papel da oração anterior para o «ou» que abre a seguinte: a
 *  alternativa herda o que a oração continuava — uma hora ou um
 *  limite já ligado como alternativa («saí às 18, ou depois das
 *  19») continua alternativa; um limite de contexto («o meu turno
 *  era até às 18, ou até às 19 às sextas») continua contexto. */
type ClauseRole = "hour" | "bound" | "loose" | "other";

/** O limite reformulado por «ou seja» é coerente quando TODAS as
 *  horas declaradas respeitam o operador — «antes das 19» vale para
 *  18:05. Uma contradição («ou seja depois das 19» para 18:05) é
 *  candidata como alternativa e ambigúa a resposta. */
function boundConsistent(
  declared: number[],
  op: string,
  boundHour: number
): boolean {
  // «até às 18 horas» é limite inclusivo — sair «às 18 horas» cumpre-o.
  if (op === "ate") {
    return declared.every((h) => h <= boundHour);
  }
  const after = op === "depois" || op === "apos";
  return declared.every((h) => (after ? h > boundHour : h < boundHour));
}

/** Decide se cada limite «depois das N horas» da oração é
 *  alternativa à saída (bound), contexto doutro acontecimento
 *  (looseBound) ou reformulação «ou seja» (aceite quando coerente
 *  com a hora declarada, ambíguo quando a contradiz). É alternativa
 *  quando a oração declara uma hora nova ou quando «ou» o liga à
 *  hora — no início («18:05, ou talvez depois das 19 horas») ou
 *  antes do limite («talvez às 18 ou só depois das 19»), com
 *  advérbios comuns pelo meio. Mas o «ou» continua a oração que o
 *  antecede: ligado a um limite de contexto («o meu turno costuma
 *  ser até às 18 horas, ou até às 19 horas às sextas») continua
 *  contexto do horário, não alternativa à saída. */
/** Interpreta a hora do limite como a declarada — «depois das 7
 *  horas» é 19:00 (a reformulação «ou seja depois das 7» de «saí
 *  às 6» contradiz 18:00); o zero inicial («07») fica em 24 h como
 *  nas horas soltas, e «da manhã/tarde/noite» sobrepõe-se («depois
 *  das 6 horas da manhã» é depois das 06:00, não das 18:00). */
function boundHourValue(m: RegExpMatchArray): number {
  // Minutos por extenso — «e meia»/«e 30»/«e 15 minutos». Um
  // minuto impossível («e 75») invalida a leitura como um
  // qualificador impossível: fica NaN e ambigúa.
  let minutes = 0;
  if (m[5]) {
    minutes = 30;
  } else if (m[3] || m[4]) {
    minutes = Number(m[3] ?? m[4]);
  }
  if (minutes > 59) {
    return Number.NaN;
  }
  const raw = m[2];
  let hour: number;
  if (m[6]) {
    hour = hourWithPeriod(Number(raw), m[6]) ?? Number.NaN;
  } else if (zeroPadded(raw)) {
    hour = Number(raw);
  } else {
    hour = exitHour(Number(raw)) ?? Number.NaN;
  }
  return hour + minutes / 60;
}

/** Veredicto «ou seja»: coerente ignora-se, contraditória é
 *  alternativa, sem hora declarada fica contexto. */
function ouSejaVerdict(
  declared: number[],
  op: string,
  boundHour: number
): "alt" | "loose" | "ignore" {
  if (declared.length === 0) {
    return "loose";
  }
  return boundConsistent(declared, op, boundHour) ? "ignore" : "alt";
}

/** O limite é alternativa à saída quando a oração traz hora nova
 *  ou volta a reivindicá-la («ou saí depois das 19», «saí depois
 *  das 19» — o verbo afirmado antes do limite descreve a saída,
 *  não o horário), ou quando «ou» o liga à hora — no início da
 *  oração, herdando o papel da anterior (contexto continua
 *  contexto do turno), ou dentro dela ligado à hora ou a uma
 *  alternativa já encadeada. */
/** A oração afirma a saída do trabalhador — na 1.ª pessoa sempre;
 *  nas formas ambíguas ou na 3.ª pessoa só com referência a si ou
 *  sem outro sujeito nomeado («o meu colega saiu», «a encomenda
 *  saiu» são contexto doutro acontecimento, não correção). */
function claimsExit(before: string): boolean {
  if (CLAIMS_EXIT_1ST_RE.test(before)) {
    return true;
  }
  return (
    CLAIMS_EXIT_3RD_RE.test(before) &&
    (SELF_EXIT_RE.test(before) || !THIRD_PERSON_RE.test(before))
  );
}

function boundIsAlternative(
  before: string,
  isFirstBound: boolean,
  startsWithOu: boolean,
  hourKind: "new" | "repeat" | "none",
  prevRole: ClauseRole | null,
  chainedAlt: boolean
): boolean {
  if (hourKind === "new" || claimsExit(before)) {
    return true;
  }
  if (isFirstBound && startsWithOu) {
    return prevRole !== "loose";
  }
  if (OU_LINK_END_RE.test(before)) {
    return hourKind !== "none" || chainedAlt;
  }
  return false;
}

function classifyBoundHours(
  clauseBoundMatches: RegExpMatchArray[],
  withoutRelatives: string,
  normalizedClause: string,
  hourKind: "new" | "repeat" | "none",
  prevRole: ClauseRole | null,
  explicit: Set<string>,
  bare: Set<string>,
  bound: Set<string>,
  looseBound: Set<string>
): { addedAlt: boolean; addedLoose: boolean } {
  const clauseTokens = normalizedClause.split(" ");
  const startsWithOu = clauseTokens[0] === "ou" && clauseTokens[1] !== "seja";
  const declared = [
    ...[...explicit].map((h) => {
      const [hh, mm] = h.split(":").map(Number);
      return hh + mm / 60;
    }),
    // A hora solta compara-se já interpretada — «às 6» é 18:00, não
    // 06:00 («saí às 6, ou seja depois das 17 horas» é coerente).
    ...[...bare].map((raw) =>
      zeroPadded(raw) ? Number(raw) : (exitHour(Number(raw)) ?? Number.NaN)
    ),
  ];
  let chainedAlt = false;
  let first = true;
  let addedAlt = false;
  let addedLoose = false;
  for (const m of clauseBoundMatches) {
    const before = withoutRelatives.slice(0, m.index).trimEnd();
    const boundHour = boundHourValue(m);
    if (OU_SEJA_END_RE.test(before)) {
      // «ou seja» reformula a hora declarada: coerente ignora-se,
      // contraditória conta como alternativa; sem hora declarada
      // fica como contexto (solto, ambigúa sozinho).
      const verdict = ouSejaVerdict(declared, m[1], boundHour);
      if (verdict === "loose") {
        looseBound.add(boundHour.toString());
        addedLoose = true;
      } else if (verdict === "alt") {
        bound.add(boundHour.toString());
        addedAlt = true;
      }
      chainedAlt = verdict === "alt";
      first = false;
      continue;
    }
    const alt = boundIsAlternative(
      before,
      first,
      startsWithOu,
      hourKind,
      prevRole,
      chainedAlt
    );
    (alt ? bound : looseBound).add(boundHour.toString());
    if (alt) {
      addedAlt = true;
    } else {
      addedLoose = true;
    }
    chainedAlt = alt;
    first = false;
  }
  return { addedAlt, addedLoose };
}

/** Junta os candidatos da oração às coleções — explícita (HH:MM ou
 *  por extenso) ou horas soltas — e devolve o papel da oração para
 *  a ligação «ou» seguinte (null quando nada contribuiu e a ligação
 *  se mantém). Durações relativas saem primeiro — «há 2 horas e 15
 *  minutos» não é a hora «14:15»; o que sobra pode trazer a hora
 *  por extenso («às 18 horas e 15 minutos» = 18:15). */
function collectClause(
  clause: string,
  explicit: Set<string>,
  bare: Set<string>,
  bound: Set<string>,
  looseBound: Set<string>,
  prevRole: ClauseRole | null
): ClauseRole | null {
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
  // A oração negada não contribui — a ligação «ou» mantém-se com o
  // que ficou de antes. (Sem texto restante — a oração era só a hora
  // compacta, «18h30» — segue-se na mesma: a negação precisa de
  // palavras mas a hora ainda há-de ser recolhida do texto cru.)
  if (negated(normalizedClause)) {
    return null;
  }
  const withoutRelatives = normalizedClause.replace(RELATIVE_DURATION_RE, " ");
  // Limites «depois das 19 horas» — não são hora solta (saem do
  // bareHours) mas contam como candidata à ambiguidade. Saem do
  // texto das horas para o leitor por extenso não ler a hora do
  // limite uma segunda vez («após as 6 horas da manhã» daria um
  // 06:00 solto além do limite).
  const clauseBoundMatches = [...withoutRelatives.matchAll(BOUND_HOUR_RE)];
  const hourKind = collectClauseHours(
    clause,
    withoutRelatives.replace(BOUND_HOUR_RE, " "),
    explicit,
    bare
  );
  const added = classifyBoundHours(
    clauseBoundMatches,
    withoutRelatives,
    normalizedClause,
    hourKind,
    prevRole,
    explicit,
    bare,
    bound,
    looseBound
  );
  if (hourKind !== "none") {
    return "hour";
  }
  // O papel mede-se pelo que a oração classificou, não pelo
  // crescimento dos conjuntos — repetir «até às 18 horas» continua
  // contexto do turno mesmo já deduplicado.
  if (added.addedAlt) {
    return "bound";
  }
  if (added.addedLoose) {
    return "loose";
  }
  // Oração sem candidatos: texto solto é contexto; nada de todo
  // (só pontuação ou uma data já tirada) não quebra a ligação.
  return normalizedClause ? "other" : null;
}

/** Mapeia os grupos de um match de DATE_SLASH_RE para a data — o
 *  primeiro ramo (grupo 1 presente) é ISO «2026-01-10» ano-mês-dia,
 *  o segundo é «23/11[/2026]» dia-mês-ano opcional. Devolve null se
 *  dia/mês forem inválidos. */
function dateMatchToParts(
  m: RegExpMatchArray
): { day: number; month: number; year: number | null } | null {
  let day: number;
  let month: number;
  let year: number | null = null;
  if (m[1] === undefined) {
    day = Number(m[4]);
    month = Number(m[5]);
    if (m[6] !== undefined) {
      const y = Number(m[6]);
      year = y < 100 ? y + 2000 : y;
    }
  } else {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  }
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return { day, month, year };
}

/** Primeira data declarada — «23/11[/2026]» dia-mês ou ISO
 *  «2026-01-10» ano-mês-dia — valida dia/mês e normaliza ano de 2
 *  dígitos. `ambiguous` quando há datas distintas declaradas
 *  («23/11 ou 24/11») — tal como duas horas, nunca se escolhe uma.
 *  A negação aplica-se por oração como às horas: «não foi a 9/1,
 *  saí a 10/1» fica só com a data afirmada — mas só quando a
 *  negação vem ANTES da data; «a 9/1 não sei a hora ao certo» não
 *  a anula nem a usa — é incerta e ambigúa. Uma forma de data
 *  reconhecida mas inválida («2026-13-10») também ambigúa: não se
 *  grava a hora noutro dia por engano. */
function statedDate(text: string): {
  ambiguous: boolean;
  date?: { day: number; month: number; year: number | null };
} {
  const keys = new Set<string>();
  let date: { day: number; month: number; year: number | null } | undefined;
  let invalid = false;
  for (const rawClause of text.split(CLAUSE_SPLIT_RE)) {
    // NFC primeiro — a posição da negação e os índices das datas
    // medem-se no mesmo texto: com o til separado («a» + U+0303)
    // a procura não encontrava o «não» e a data negada ficava
    // incerta em vez de anulada.
    const clause = rawClause.normalize("NFC");
    const clauseNegated = negated(normalizePontoText(clause));
    const negIdx = clauseNegated
      ? clause.toLowerCase().search(NEGATION_START_RE)
      : -1;
    for (const m of clause.matchAll(DATE_SLASH_RE)) {
      if (clauseNegated) {
        if (negIdx >= 0 && negIdx < m.index) {
          continue; // a negação antes da data anula-a
        }
        invalid = true; // âmbito da negação incerto — pergunta-se
        continue;
      }
      const parsed = dateMatchToParts(m);
      if (!parsed) {
        invalid = true; // forma de data reconhecida mas inválida
        continue;
      }
      keys.add(`${parsed.year ?? "*"}/${parsed.month}/${parsed.day}`);
      date ??= parsed;
    }
  }
  return { ambiguous: keys.size > 1 || invalid, date };
}

export function parsePontoExitAnswer(
  text: string | null | undefined
): PontoExitAnswer {
  if (!text) {
    return null;
  }
  // Data declarada («23/11») — sai do texto dos dígitos mas fica
  // registada na resposta: o handler só grava se bater num dos dias
  // candidatos do turno, senão repete a pergunta. Duas datas
  // distintas («23/11 ou 24/11») são ambíguas como duas horas.
  const stated = statedDate(text);
  if (stated.ambiguous) {
    return { kind: "ambiguous" };
  }
  const date = stated.date;
  // 1) Horas por oração — uma negação só descarta a hora da própria
  //    oração: "não, saí às 18:20" afirma 18:20; "não saí às 18:00,
  //    ainda estou a trabalhar" não declara nada.
  const explicit = new Set<string>();
  const bare = new Set<string>();
  const bound = new Set<string>();
  const looseBound = new Set<string>();
  let prevRole: ClauseRole | null = null;
  for (const clause of text.split(CLAUSE_SPLIT_RE)) {
    const role = collectClause(
      clause,
      explicit,
      bare,
      bound,
      looseBound,
      prevRole
    );
    if (role !== null) {
      prevRole = role;
    }
  }
  if (explicit.size === 1 && bound.size === 0) {
    return { date, hhmm: [...explicit][0], kind: "time" };
  }
  if (explicit.size > 1 || (explicit.size === 1 && bound.size > 0)) {
    // Ambíguo — duas ou mais horas declaradas (uma hora mais um
    // limite «depois das 19 horas» na mesma oração também tem duas
    // candidatas). O handler repete a pergunta sem gravar; a
    // distinção de «sem hora» (null) serve para a rota de comandos
    // não engolir a resposta (SAÍDA com horas em conflito não pode
    // gravar a hora de receção).
    return { kind: "ambiguous" };
  }

  const normalized = normalizePontoText(text);
  if (!normalized) {
    return null;
  }
  // Um limite com hora na própria oração («saí às 18 depois das
  // 19») contradiz a hora — ambíguo. Um limite sozinho na resposta
  // inteira («saí depois das 19 horas») não é hora declarada —
  // pede-se uma exata. Já um limite noutra oração («o meu turno
  // era até às 18 horas») fala doutro acontecimento e não entra.
  if (bound.size > 0) {
    return { kind: "ambiguous" };
  }
  if (looseBound.size > 0 && explicit.size === 0 && bare.size === 0) {
    return { kind: "ambiguous" };
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
      return { date, hhmm, kind: "time" };
    }
  }
  if (bare.size > 1) {
    return { kind: "ambiguous" };
  }
  return null;
}
