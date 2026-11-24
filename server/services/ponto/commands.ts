// Parser dos comandos do livro de ponto (plano §2.2c).
//
// Regras duras:
// - Normalização: minúsculas → NFD sem acentos → pontuação/emojis viram
//   espaço → espaços colapsados. Assim "SAÍDA!!! 😤" e "saida" são o
//   mesmo comando, e "#4821" vira o token "4821".
// - Sinónimos PT-PT por comando + tolerância a 1 erro de edição
//   (OSA ≤ 1) apenas em palavras com ≥5 letras — "entardas"→ENTRADA,
//   "almoco"→PAUSA, mas "sai" nunca casa por fuzzy.
// - Código de entrada: \b\d{4}\b em qualquer posição (o fluxo do QR é
//   "ENTRADA <slug-da-loja> #<codigo>" — as palavras do slug são
//   toleradas quando há código; sem código a cobertura é estrita para
//   não registar "fim de semana" como VOLTEI).
// - IDs de botão Meta/Evolution ("ponto_entrada"…) são autoridade
//   absoluta e vêm do campo interactivo, não do texto normalizado.
// - Ambiguidade → null: o handler responde com a lista de comandos.
// - Negação: "não"/"nunca"/"jamais" antes do fim do último match →
//   null ("não saí" nunca regista SAÍDA).

export type PontoCommand = "ENTRADA" | "PAUSA" | "VOLTEI" | "SAIDA" | "ESTADO";

export interface ParsedPontoCommand {
  code?: string;
  command: PontoCommand;
}

const COMMAND_WORDS: Record<PontoCommand, string[]> = {
  ENTRADA: ["entrada", "entrei", "cheguei"],
  ESTADO: ["estado", "horas"],
  PAUSA: ["almoco", "cafe", "intervalo", "pausa"],
  SAIDA: ["adeus", "fui", "sai", "saida", "saiu"],
  VOLTEI: ["fim", "regresso", "volta", "voltei"],
};

// Frases de 2+ tokens avaliadas antes dos matches de token simples.
const COMMAND_PHRASES: { command: PontoCommand; tokens: string[] }[] = [
  { command: "ENTRADA", tokens: ["bom", "dia"] },
];

const BUTTON_ID_RE = /^ponto_(entrada|pausa|voltei|saida)$/i;
const CODE_RE = /\b\d{4}\b/;
const DIGITS_ONLY_RE = /^\d+$/;
const NEGATION_WORDS = new Set(["jamais", "nao", "nunca"]);
const FUZZY_MIN_LEN = 5;
const FUZZY_MAX_DISTANCE = 1;

// Exportada para o parser de respostas ao lembrete de saída
// (exit-answer.ts) — a mesma normalização (minúsculas, sem acentos,
// pontuação→espaço) aplica-se às duas interpretações.
export function normalizePontoText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Distância OSA (optimal string alignment): substituição, inserção,
// remoção e transposição de adjacentes. Suficiente para tolerar 1 erro
// de digitação — "entrdas", "voltei"→"voltei".
function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > FUZZY_MAX_DISTANCE) {
    return FUZZY_MAX_DISTANCE + 1;
  }
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) {
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    d[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1);
      }
      d[i][j] = best;
    }
  }
  return d[m][n];
}

// Comandos candidatos para um token: match exato sempre; fuzzy só em
// palavras com ≥5 letras (evita "sai"→"dia" e afins).
function commandsForToken(token: string): Set<PontoCommand> {
  const found = new Set<PontoCommand>();
  const canFuzzy = token.length >= FUZZY_MIN_LEN;
  for (const [command, words] of Object.entries(COMMAND_WORDS) as [
    PontoCommand,
    string[],
  ][]) {
    for (const word of words) {
      if (token === word) {
        found.add(command);
        break;
      }
      if (
        canFuzzy &&
        word.length >= FUZZY_MIN_LEN &&
        osaDistance(token, word) <= FUZZY_MAX_DISTANCE
      ) {
        found.add(command);
        break;
      }
    }
  }
  return found;
}

function buttonCommand(id: string | null | undefined): PontoCommand | null {
  if (!id) {
    return null;
  }
  const match = BUTTON_ID_RE.exec(id.trim());
  if (!match) {
    return null;
  }
  const key = match[1].toLowerCase() as Lowercase<PontoCommand>;
  return key.toUpperCase() as PontoCommand;
}

interface CommandSpan {
  commands: Set<PontoCommand>;
  end: number;
  start: number;
}

/** Frase de 2 tokens que começa em `i` ("bom dia" → ENTRADA). */
function phraseAt(
  tokens: string[],
  i: number
): { command: PontoCommand; length: number } | null {
  const phrase = COMMAND_PHRASES.find(
    (p) =>
      p.tokens.length === 2 &&
      tokens[i] === p.tokens[0] &&
      tokens[i + 1] === p.tokens[1]
  );
  return phrase ? { command: phrase.command, length: 2 } : null;
}

/** Percorre os tokens marcando spans de comando e a cobertura —
 *  frases primeiro, depois token a token. */
function collectSpans(tokens: string[]): {
  covered: boolean[];
  spans: CommandSpan[];
} {
  const spans: CommandSpan[] = [];
  const covered = new Array<boolean>(tokens.length).fill(false);
  let i = 0;
  while (i < tokens.length) {
    const phrase = phraseAt(tokens, i);
    if (phrase) {
      spans.push({
        commands: new Set([phrase.command]),
        end: i + phrase.length,
        start: i,
      });
      for (let j = i; j < i + phrase.length; j++) {
        covered[j] = true;
      }
      i += phrase.length;
      continue;
    }
    const commands = commandsForToken(tokens[i]);
    if (commands.size > 0) {
      spans.push({ commands, end: i + 1, start: i });
      covered[i] = true;
    }
    i++;
  }
  return { covered, spans };
}

/** Um único comando distinto em todos os spans — senão ambíguo. */
function singleCommandOf(spans: CommandSpan[]): PontoCommand | null {
  const distinct = new Set<PontoCommand>();
  for (const span of spans) {
    for (const c of span.commands) {
      distinct.add(c);
    }
  }
  return distinct.size === 1 ? [...distinct][0] : null;
}

/** "não saí" nunca regista: negação antes do fim do último match. */
function negatedBefore(tokens: string[], lastEnd: number): boolean {
  for (let j = 0; j < lastEnd; j++) {
    if (NEGATION_WORDS.has(tokens[j])) {
      return true;
    }
  }
  return false;
}

/** Sem código, todo o token não-numérico tem de estar coberto
 *  ("fim de semana" não é VOLTEI). Com código (fluxo QR com slug da
 *  loja) tokens soltos são tolerados. */
function fullyCovered(tokens: string[], covered: boolean[]): boolean {
  return tokens.every((token, j) => covered[j] || DIGITS_ONLY_RE.test(token));
}

export function parsePontoCommand(
  text: string | null | undefined,
  interactiveId?: string | null
): ParsedPontoCommand | null {
  // 1) Botão interativo: o id é autoridade — nem precisa de texto.
  const fromButton = buttonCommand(interactiveId) ?? buttonCommand(text);
  if (fromButton) {
    return { command: fromButton };
  }
  if (!text) {
    return null;
  }

  const normalized = normalizePontoText(text);
  if (!normalized) {
    return null;
  }

  const codeMatch = CODE_RE.exec(normalized);
  const code = codeMatch ? codeMatch[0] : undefined;
  const tokens = normalized.split(" ");
  const { covered, spans } = collectSpans(tokens);
  if (spans.length === 0) {
    return null;
  }
  const command = singleCommandOf(spans);
  if (!command) {
    return null;
  }
  const lastEnd = Math.max(...spans.map((s) => s.end));
  if (negatedBefore(tokens, lastEnd)) {
    return null;
  }
  if (!(code || fullyCovered(tokens, covered))) {
    return null;
  }
  return code ? { code, command } : { command };
}
