import type { PartCategoryType } from "@shared/constants/part-categories";
import type { RepairCategoryType } from "@shared/constants/repair-categories";

/**
 * Pré-orçamento determinístico do intake diag — puro e sem I/O para ser
 * testável isoladamente. Dado o payload de diagnóstico (results
 * checkKey → {Status, Value, Detail}), os catálogos ativos e o catálogo de
 * devices da loja, emite linhas de orçamento advisory: a app NUNCA
 * pré-preenche um Job — o staff revê e escolhe o que se aplica.
 *
 * Regras duras do desenho:
 *  - purpose "sale" ou nenhum check fail/warn → sugestão vazia (skip).
 *  - Sem deviceMatch só saem linhas RepairCatalog SOFTWARE/DIAGNOSTIC —
 *    peças e repairs de hardware ficam de fora e vão para unmatchedChecks.
 *  - Nunca se emite linha sem candidato de catálogo — checks sem candidato
 *    ficam visíveis em unmatchedChecks.
 */

// ── Inputs ──────────────────────────────────────────────────────────

/** Entrada de diagnostic.results — o diag envia {Status, Value, Detail}. */
export interface QuoteDiagnosticCheck {
  Status?: unknown;
  status?: unknown;
  Value?: unknown;
  value?: unknown;
}

export interface QuoteDiagnosticInput {
  device?: {
    brand?: string;
    MarketingName?: string;
    marketingName?: string;
    model?: string;
    os?: string;
    osVersion?: string;
  } | null;
  purpose?: string | null;
  results?: Record<string, unknown> | null;
}

export interface QuotePartInput {
  category: PartCategoryType;
  defaultPrice: number | string | { toString(): string };
  id: string;
  isActive?: boolean;
  name: string;
  stockQuantity: number;
}

export interface QuoteRepairInput {
  category: RepairCategoryType;
  defaultPrice: number | string | { toString(): string };
  id: string;
  isActive?: boolean;
  name: string;
}

export interface QuoteDeviceInput {
  brandName: string;
  id: string;
  model: string;
}

// ── Output ──────────────────────────────────────────────────────────

export type QuoteConfidence = "high" | "low";

// Output shapes are interfaces (codebase style). They are persisted to the
// Json column via a cast at the boundary — interfaces lack the implicit
// index signature Prisma.InputJsonValue requires (same pattern as
// job.service.ts intakeTermsSnapshot).
export interface QuoteSuggestionLine {
  catalogId: string;
  confidence: QuoteConfidence;
  /** Peças: stockQuantity > 0. Repairs são sempre "em stock". */
  inStock: boolean;
  kind: "repair" | "part";
  name: string;
  /** Preço de catálogo em cêntimos (defaultPrice é Decimal em euros). */
  priceCents: number;
  /** Checks de diagnóstico que motivaram a linha (", "-joined quando funde). */
  reasonCheck: string;
  /** Pior estado entre os checks que motivaram a linha. */
  reasonStatus: "fail" | "warn" | "info";
}

export interface QuoteSuggestionDeviceMatch {
  brand: string;
  confidence: QuoteConfidence;
  deviceId: string;
  model: string;
}

export interface QuoteSuggestionDeviceCandidate {
  brand: string;
  deviceId: string;
  model: string;
}

export interface QuoteSuggestion {
  /** Matches aproximados do modelo quando confidence = "low" (top-N). */
  candidates?: QuoteSuggestionDeviceCandidate[];
  deviceMatch: QuoteSuggestionDeviceMatch | null;
  generatedAt: string;
  lines: QuoteSuggestionLine[];
  skippedReason?: "no-fail-warn-checks" | "purpose-sale";
  unmatchedChecks: string[];
}

// ── Normalização (espelho de normalizePriceKey) ─────────────────────

const NON_ALNUM = /[^a-z0-9]+/g;
const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Mesma forma canónica de normalizePriceKey (market-prices.service) —
 * duplicada aqui para o serviço continuar puro (zero imports de runtime).
 * Manter as duas em sincronia.
 */
function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_ALNUM, " ")
    .trim()
    .slice(0, 200);
}

// ── Tabela check → categoria ────────────────────────────────────────

interface CheckRule {
  /** expressões que identificam OUTRO componente: itens cujo nome as
   * contém são excluídos dos candidatos desta regra. */
  excludeHints?: string[];
  hints: string[];
  partCategory?: PartCategoryType;
  repairCategories: RepairCategoryType[];
  /** true = a linha só sai com deviceMatch (hardware). */
  requiresDeviceMatch: boolean;
  /** hints multi-palavra só correspondem quando o NOME DO ITEM os contém
   * (o inverso — item contido no hint — é rejeitado). Usado pelo
   * earpiece para «Speaker» não casar com «speaker de chamadas». */
  strictMultiWord?: boolean;
}

const HARDWARE: RepairCategoryType[] = ["HARDWARE"];
const SOFTWARE_OR_DIAG: RepairCategoryType[] = ["SOFTWARE", "DIAGNOSTIC"];

const RULE_BATTERY: CheckRule = {
  hints: ["bateria", "battery"],
  partCategory: "BATTERY",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_SCREEN: CheckRule = {
  hints: ["ecrã", "display", "screen", "painel"],
  partCategory: "SCREEN",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_CHARGING: CheckRule = {
  hints: [
    "porta de carga",
    "conector de carga",
    "charging port",
    "usb-c",
    "usb c",
  ],
  partCategory: "CHARGING_PORT",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_CAMERA: CheckRule = {
  hints: ["câmara", "camera"],
  partCategory: "CAMERA",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_SPEAKER: CheckRule = {
  // Coluna/altifalante principal. O earpiece de chamadas é outro
  // componente físico → RULE_EARPIECE (regra própria = linha própria).
  hints: ["altifalante", "speaker", "coluna"],
  // «Altifalante superior»/«speaker de chamadas» são o earpiece: sem esta
  // exclusão a regra da coluna também os escolhia e as duas avarias
  // fundiam-se numa só linha (BUG #166 r3).
  excludeHints: [
    "altifalante de chamadas",
    "altifalante superior",
    "speaker de chamadas",
  ],
  partCategory: "SPEAKER",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_EARPIECE: CheckRule = {
  // Auricular/earpiece = altifalante de chamadas (ouvir) — NÃO o
  // microfone. Divide a categoria SPEAKER com RULE_SPEAKER mas tem hints
  // próprios: speaker e earpiece avariados são duas linhas, não uma.
  hints: [
    "auricular",
    "earpiece",
    "receiver",
    "altifalante de chamadas",
    "altifalante superior",
    "speaker de chamadas",
  ],
  // Multi-palavra só no sentido item→hint: «Speaker» (a coluna) não pode
  // casar com «speaker de chamadas». Os hints simples mantêm os dois
  // sentidos (ex.: «Fone auricular»).
  strictMultiWord: true,
  partCategory: "SPEAKER",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_MICROPHONE: CheckRule = {
  hints: ["microfone", "microphone"],
  partCategory: "MICROPHONE",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_LIQUID: CheckRule = {
  hints: ["placa", "motherboard", "logic board", "placa lógica"],
  partCategory: "MOTHERBOARD",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_BUTTON: CheckRule = {
  hints: ["botões", "buttons", "power", "flex de botões"],
  partCategory: "BUTTON",
  repairCategories: HARDWARE,
  requiresDeviceMatch: true,
};
const RULE_SOFTWARE: CheckRule = {
  hints: ["software", "formatação", "desbloqueio", "unlock", "reset"],
  repairCategories: SOFTWARE_OR_DIAG,
  requiresDeviceMatch: false,
};
const RULE_SIM: CheckRule = {
  hints: ["cartão sim", "sim card", "leitor sim"],
  repairCategories: SOFTWARE_OR_DIAG,
  requiresDeviceMatch: false,
};
const RULE_LOGS: CheckRule = {
  hints: ["diagnóstico", "crash", "panic", "logs"],
  repairCategories: SOFTWARE_OR_DIAG,
  requiresDeviceMatch: false,
};

const EXACT_RULES: Record<string, CheckRule> = {
  "checklist.buttons": RULE_BUTTON,
  "checklist.cameras": RULE_CAMERA,
  "checklist.charge_port": RULE_CHARGING,
  "checklist.earpiece": RULE_EARPIECE,
  "checklist.liquid": RULE_LIQUID,
  "checklist.mic": RULE_MICROPHONE,
  "checklist.screen_visual": RULE_SCREEN,
  "checklist.speaker": RULE_SPEAKER,
  "device.sim": RULE_SIM,
  "logs.crashes": RULE_LOGS,
  "logs.panics": RULE_LOGS,
  "perf.usb": RULE_CHARGING,
  "power.charge": RULE_CHARGING,
  "sensor.mic": RULE_MICROPHONE,
  "sensor.multitouch": RULE_SCREEN,
  "sensor.speaker": RULE_SPEAKER,
  "test.edges": RULE_SCREEN,
  "test.screen": RULE_SCREEN,
  "test.touch": RULE_SCREEN,
  "usb.stability": RULE_CHARGING,
};

/**
 * Resolve a regra de um checkKey (case-insensitive). Os prefixos
 * tpl.battery./tpl.screen. são os itens do checklist do template de
 * serviço — um fail neles é sinal da mesma peça que os checks battery.*
 * ou test.* do scan produziriam.
 */
function ruleForCheck(key: string): CheckRule | null {
  const k = key.toLowerCase();
  const exact = EXACT_RULES[k];
  if (exact) {
    return exact;
  }
  if (k.startsWith("battery.") || k.startsWith("tpl.battery.")) {
    return RULE_BATTERY;
  }
  if (k.startsWith("tpl.screen.")) {
    return RULE_SCREEN;
  }
  if (k.startsWith("security.")) {
    return RULE_SOFTWARE;
  }
  return null;
}

/**
 * service.template = template de serviço aplicado no diag (battery/screen).
 * Usado/manutencao/whatsapp não são orçamento de reparação → sem prioridade.
 */
const TEMPLATE_RULES: Record<string, { hints: string[]; rule: CheckRule }> = {
  battery: { hints: ["bateria", "troca de bateria"], rule: RULE_BATTERY },
  screen: {
    hints: ["ecrã", "display", "screen", "troca de ecrã"],
    rule: RULE_SCREEN,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function checkValue(check: unknown): unknown {
  if (!check || typeof check !== "object") {
    return;
  }
  const c = check as QuoteDiagnosticCheck;
  return c.Value ?? c.value;
}

function checkStatus(check: unknown): string {
  if (!check || typeof check !== "object") {
    return "";
  }
  const c = check as QuoteDiagnosticCheck;
  return String(c.Status ?? c.status ?? "").toLowerCase();
}

function toCents(price: QuotePartInput["defaultPrice"]): number {
  return Math.round(Number(price) * 100);
}

/** Comparador lexicográfico determinístico para strings normalizadas. */
function compareStr(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

interface ScoredCandidate<T> {
  confidence: QuoteConfidence;
  /** Nome do item menciona o modelo/nome comercial do aparelho. */
  deviceHit: boolean;
  item: T;
  norm: string;
  rank: number;
  stock: number;
}

/**
 * Confiança do nome do item face a um conjunto de hints normalizados:
 * equals → "high" (match exato), contains → "low". Um equals em qualquer
 * hint ganha sempre.
 *
 * A direcção do contains depende da regra (strictMultiWord): por defeito
 * os dois sentidos valem — «Conector» contém-se em «conector de carga» e
 * nomes abreviados continuam a casar. Com strictMultiWord (earpiece),
 * expressões multi-palavra («speaker de chamadas», «altifalante
 * superior») identificam um componente concreto e só contam quando o
 * NOME DO ITEM as contém — aceitar o inverso («Speaker» contido em
 * «speaker de chamadas») sugeria a coluna como auricular (BUG #166 r2).
 */
function matchConfidence(
  norm: string,
  hints: string[],
  strictMultiWord = false
): QuoteConfidence | null {
  let confidence: QuoteConfidence | null = null;
  for (const hint of hints) {
    if (norm === hint) {
      return "high";
    }
    const specific = hint.includes(" ");
    if (
      norm.includes(hint) ||
      (hint.includes(norm) && !(specific && strictMultiWord))
    ) {
      confidence = "low";
    }
  }
  return confidence;
}

/**
 * Tokens que distinguem variantes do mesmo modelo base («iPhone 15» vs
 * «iPhone 15 Pro», «Galaxy S24» vs «S24 Ultra»). Um nome de catálogo que
 * continua com um destes tokens a seguir ao modelo é OUTRA variante —
 * «Bateria iPhone 15 Pro» não serve um iPhone 15 (BUG #166 r7).
 */
const MODEL_VARIANT_TOKENS = new Set([
  "fe",
  "lite",
  "max",
  "mini",
  "plus",
  "pro",
  "ultra",
]);

// Frases comerciais que CONTÊM um token de variante mas não são variantes
// de modelo — «bateria iphone 15 – max capacity» é a bateria do 15, não
// do 15 Pro Max (BUG #166 r9). Um descritor genérico a seguir à variante
// («…15 Pro OEM») NÃO salva a correspondência (BUG #166 r10).
const COMMERCIAL_VARIANT_PHRASES = new Set(["max capacity"]);

/**
 * Contains por palavra inteira com rejeição de variantes: devolve true se
 * `needle` ocorre em `haystack` (ambos normalizados) e a palavra seguinte
 * à ocorrência não estende o modelo com uma variante («iphone 15 pro»).
 * A variante conta no fim da menção, antes de outra variante ou antes
 * de um descritor («…15 Pro OEM») — só uma frase comercial conhecida
 * («max capacity») mantém a correspondência com o modelo base
 * (BUG #166 r9/r10).
 */
function deviceModelContained(haystack: string, needle: string): boolean {
  const hay = ` ${haystack} `;
  const ned = ` ${needle} `;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(ned, from);
    if (idx === -1) {
      return false;
    }
    const words = hay
      .slice(idx + ned.length)
      .trimStart()
      .split(" ")
      .filter((w) => w.length > 0);
    const next = words[0] ?? "";
    if (!MODEL_VARIANT_TOKENS.has(next)) {
      return true;
    }
    // «…15 – Max Capacity» é descrição comercial (BUG #166 r9); «…15 Pro
    // OEM» continua a ser variante (BUG #166 r10) — descritor genérico
    // não salva a correspondência, só a frase comercial conhecida.
    if (COMMERCIAL_VARIANT_PHRASES.has(`${next} ${words[1] ?? ""}`.trim())) {
      return true;
    }
    from = idx + 1;
  }
}

/**
 * Ordem de preferência entre REPARAÇÕES — sempre determinístico:
 *  1. rank: igualdade EXATA de hint (equals) > contains. O deviceHit NÃO
 *     promove um contains a equals — ex.: "Troca de bateria" (exato do
 *     template) ganha a "Troca de bateria iPhone 15" (contains+deviceHit).
 *  2. deviceHit: entre não-exatos, o item que menciona o modelo do
 *     aparelho ganha (compatibilidade por nome — ver pickBest).
 *  3. nome normalizado, depois id. (stock é sempre 0 — não desdobra.)
 */
function isPreferredRepair<T extends { id: string; name: string }>(
  next: ScoredCandidate<T>,
  best: ScoredCandidate<T>
): boolean {
  if (next.rank !== best.rank) {
    return next.rank > best.rank;
  }
  if (next.deviceHit !== best.deviceHit) {
    return next.deviceHit;
  }
  if (next.stock !== best.stock) {
    return next.stock > best.stock;
  }
  const byNorm = compareStr(next.norm, best.norm);
  if (byNorm !== 0) {
    return byNorm < 0;
  }
  return next.item.id < best.item.id;
}

/**
 * Ordem de preferência entre PEÇAS — de bancada, diferente das
 * reparações porque uma peça errada ou indisponível trava o serviço:
 *  1. deviceHit: a peça que menciona o modelo do aparelho ganha sempre —
 *     uma peça de OUTRO modelo nunca ganha à do modelo certo, mesmo
 *     esgotada (decisão do dono; sugeria «Bateria Samsung» para um
 *     iPhone 15 — BUG #166 r6); a do modelo certo fica «sob encomenda».
 *  2. stock>0: entre peças do mesmo modelo (ou genéricas), a
 *     disponibilidade decide — uma peça exata mas esgotada não resolve
 *     hoje; a que está em stock ganha mesmo sendo contains
 *     (BUG #166 r3: "Bateria iPhone 15" em stock ganha a "Bateria"
 *     exata esgotada).
 *  3. rank: equals > contains — com o mesmo modelo e stock, a exatidão
 *     do nome decide ("Bateria" ganha a "Bateria universal" — r2/r3).
 *  4. nome normalizado, depois id.
 */
function isPreferredPart<T extends { id: string; name: string }>(
  next: ScoredCandidate<T>,
  best: ScoredCandidate<T>
): boolean {
  if (next.deviceHit !== best.deviceHit) {
    return next.deviceHit;
  }
  if (next.stock !== best.stock) {
    return next.stock > best.stock;
  }
  if (next.rank !== best.rank) {
    return next.rank > best.rank;
  }
  const byNorm = compareStr(next.norm, best.norm);
  if (byNorm !== 0) {
    return byNorm < 0;
  }
  return next.item.id < best.item.id;
}

/**
 * excludeHints identificam OUTRO componente (ex.: o earpiece para a regra
 * da coluna). Um nome que fala SÓ dele é ignorado; um serviço combinado
 * («Troca de coluna e altifalante superior») serve às duas avarias — se,
 * removida a expressão alheia, o nome ainda casa com os hints da regra,
 * o candidato mantém-se (BUG #166 r4). stripped vazio = o nome É a
 * expressão alheia («Altifalante superior» para a coluna): rejeita —
 * matchConfidence aceitaria a cadeia vazia, que todo hint contém
 * (BUG #166 r5).
 */
function excludedByOtherComponent(
  norm: string,
  normalizedExclude: string[],
  normalizedHints: string[],
  strictMultiWord: boolean
): boolean {
  if (!normalizedExclude.some((ex) => norm.includes(ex))) {
    return false;
  }
  const stripped = normalizedExclude
    .reduce((acc, ex) => acc.split(ex).join(" "), norm)
    .replace(/\s+/g, " ")
    .trim();
  return (
    !stripped ||
    matchConfidence(stripped, normalizedHints, strictMultiWord) === null
  );
}

/**
 * Melhor candidato de um pool para os hints dados. Empates desempatados por
 * isPreferredPart (peças — forParts) ou isPreferredRepair (reparações) —
 * determinístico.
 *
 * deviceHints (nomes normalizados do modelo/nome comercial do aparelho
 * matched) não são gate de match — são desempate: entre candidatos com o
 * mesmo rank de hint, o que menciona o modelo ganha (e a confidence
 * mostrada passa a "high"). O catálogo não tem campo peça↔modelo, por
 * isso a heurística é por nome; itens sem o nome do modelo não são
 * penalizados — só perdem o desempate (limitação documentada:
 * compatibilidade real pode divergir do nome).
 */
function pickBest<T extends { id: string; name: string }>(
  pool: T[],
  hints: string[],
  stockOf?: (item: T) => number,
  deviceHints: string[] = [],
  strictMultiWord = false,
  excludeHints: string[] = [],
  forParts = false
): ScoredCandidate<T> | null {
  const normalizedHints = hints
    .map((h) => normalizeKey(h))
    .filter((h) => h.length > 0);
  const normalizedDeviceHints = deviceHints.filter((h) => h.length > 0);
  const normalizedExclude = excludeHints
    .map((h) => normalizeKey(h))
    .filter((h) => h.length > 0);
  const prefer = forParts ? isPreferredPart : isPreferredRepair;
  let best: ScoredCandidate<T> | null = null;

  for (const item of pool) {
    const norm = normalizeKey(item.name);
    if (
      !norm ||
      excludedByOtherComponent(
        norm,
        normalizedExclude,
        normalizedHints,
        strictMultiWord
      )
    ) {
      continue;
    }
    const matched = matchConfidence(norm, normalizedHints, strictMultiWord);
    if (!matched) {
      continue;
    }
    const deviceHit = normalizedDeviceHints.some(
      (h) => deviceModelContained(norm, h) || deviceModelContained(h, norm)
    );
    const candidate: ScoredCandidate<T> = {
      // confidence de exibição: exact ou deviceHit → "high". O rank, em
      // contraste, reflete SÓ a igualdade exata — deviceHit nunca promove
      // um contains a equals na ordenação (isPreferredPart/Repair).
      confidence: deviceHit ? "high" : matched,
      deviceHit,
      item,
      norm,
      rank: matched === "high" ? 2 : 1,
      stock: stockOf ? stockOf(item) : 0,
    };
    if (!best || prefer(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Escolha em cache por CheckRule: a primeira emit de uma regra (tipicamente
 * o service.template, que corre primeiro) decide a linha; emits seguintes
 * de checks da mesma regra reutilizam-na — addLine funde as razões na
 * mesma linha em vez de criar uma segunda linha com outro candidato.
 */
function pickCached<T extends { id: string; name: string }>(
  cache: Map<CheckRule, ScoredCandidate<T>>,
  rule: CheckRule,
  pick: () => ScoredCandidate<T> | null
): ScoredCandidate<T> | null {
  const cached = cache.get(rule);
  if (cached) {
    return cached;
  }
  const picked = pick();
  if (picked) {
    cache.set(rule, picked);
  }
  return picked;
}

// ── Device match ────────────────────────────────────────────────────

const DEVICE_CANDIDATE_LIMIT = 5;

function byModelThenId(a: QuoteDeviceInput, b: QuoteDeviceInput): number {
  const na = normalizeKey(a.model);
  const nb = normalizeKey(b.model);
  if (na !== nb) {
    return na < nb ? -1 : 1;
  }
  return compareStr(a.id, b.id);
}

/** Nomes a testar no match: marketingName primeiro (nome comercial), model
 * como fallback — o diag nem sempre envia marketingName e o model pode ser
 * um código interno (SM-x, A1xxx). Normalizados e deduplicados. */
function diagnosticNames(device: QuoteDiagnosticInput["device"]): string[] {
  return [device?.marketingName ?? device?.MarketingName, device?.model]
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => normalizeKey(n))
    .filter((n, i, arr) => n.length > 0 && arr.indexOf(n) === i);
}

/** Particiona os devices da marca num nome normalizado: equals → highs,
 * contains em qualquer direção → lows. */
function scanBrandDevices(
  brandDevices: QuoteDeviceInput[],
  norm: string
): { highs: QuoteDeviceInput[]; lows: QuoteDeviceInput[] } {
  const highs: QuoteDeviceInput[] = [];
  const lows: QuoteDeviceInput[] = [];
  for (const d of brandDevices) {
    const dn = normalizeKey(d.model);
    if (!dn) {
      continue;
    }
    if (dn === norm) {
      highs.push(d);
    } else if (dn.includes(norm) || norm.includes(dn)) {
      lows.push(d);
    }
  }
  return { highs, lows };
}

function toDeviceMatch(
  d: QuoteDeviceInput,
  confidence: QuoteConfidence
): QuoteSuggestionDeviceMatch {
  return {
    brand: d.brandName,
    confidence,
    deviceId: d.id,
    model: d.model,
  };
}

function toDeviceCandidate(
  d: QuoteDeviceInput
): QuoteSuggestionDeviceCandidate {
  return { brand: d.brandName, deviceId: d.id, model: d.model };
}

/**
 * brand (case-insensitive) + marketingName ?? model → Device do catálogo.
 * Equals → confidence "high"; startsWith/contains → "low" com candidates
 * top-N para o staff escolher. Sem match → deviceMatch null.
 */
function matchDevice(
  device: QuoteDiagnosticInput["device"],
  devices: QuoteDeviceInput[]
): {
  candidates: QuoteSuggestionDeviceCandidate[];
  deviceMatch: QuoteSuggestionDeviceMatch | null;
} {
  const brandNorm = normalizeKey(device?.brand ?? "");
  const brandDevices = brandNorm
    ? devices.filter((d) => normalizeKey(d.brandName) === brandNorm)
    : [];
  if (brandDevices.length === 0) {
    return { candidates: [], deviceMatch: null };
  }

  // marketingName (nome comercial) tem prioridade sobre model (código
  // interno): o primeiro nome que produzir qualquer match ganha — mesmo
  // aproximado — porque o catálogo da loja usa nomes comerciais, não códigos.
  for (const norm of diagnosticNames(device)) {
    const { highs, lows } = scanBrandDevices(brandDevices, norm);
    if (highs.length > 0) {
      highs.sort(byModelThenId);
      return { candidates: [], deviceMatch: toDeviceMatch(highs[0], "high") };
    }
    if (lows.length > 0) {
      lows.sort(byModelThenId);
      const top = lows.slice(0, DEVICE_CANDIDATE_LIMIT);
      return {
        candidates: top.map(toDeviceCandidate),
        deviceMatch: toDeviceMatch(top[0], "low"),
      };
    }
  }

  return { candidates: [], deviceMatch: null };
}

// ── Main ────────────────────────────────────────────────────────────

interface LineAccumulator {
  catalogId: string;
  confidence: QuoteConfidence;
  inStock: boolean;
  kind: "repair" | "part";
  name: string;
  priceCents: number;
  reasons: { check: string; status: "fail" | "info" | "warn" }[];
}

/**
 * Acumula uma linha de orçamento: checks diferentes que apontam para a mesma
 * peça/serviço fundem-se numa linha com várias razões. Um match "high" eleva
 * a confiança da linha fundida.
 */
function addLine(
  lines: Map<string, LineAccumulator>,
  entry: {
    catalogId: string;
    checkKey: string;
    confidence: QuoteConfidence;
    inStock: boolean;
    kind: "repair" | "part";
    name: string;
    price: QuotePartInput["defaultPrice"];
    status: "fail" | "info" | "warn";
  }
): void {
  const mapKey = `${entry.kind}:${entry.catalogId}`;
  const existing = lines.get(mapKey);
  if (existing) {
    existing.reasons.push({ check: entry.checkKey, status: entry.status });
    if (entry.confidence === "high") {
      existing.confidence = "high";
    }
    return;
  }
  lines.set(mapKey, {
    catalogId: entry.catalogId,
    confidence: entry.confidence,
    inStock: entry.inStock,
    kind: entry.kind,
    name: entry.name,
    priceCents: toCents(entry.price),
    reasons: [{ check: entry.checkKey, status: entry.status }],
  });
}

const STATUS_RANK: Record<string, number> = { fail: 3, warn: 2, info: 1 };

interface EmitContext {
  deviceHints: string[];
  deviceMatch: QuoteSuggestionDeviceMatch | null;
  lines: Map<string, LineAccumulator>;
  matchedChecks: Set<string>;
  partChoice: Map<CheckRule, ScoredCandidate<QuotePartInput>>;
  parts: QuotePartInput[];
  repairChoice: Map<CheckRule, ScoredCandidate<QuoteRepairInput>>;
  repairs: QuoteRepairInput[];
}

/**
 * Emite as linhas (peça + reparação) de uma CheckRule para um checkKey.
 * partExtra alimenta só a escolha da peça (suggest.parts são "peças
 * prováveis" do Grader); repairExtra alimenta só a escolha do serviço
 * (hints do service.template). Misturar os dois criava sugestões
 * cruzadas — ex.: check de bateria a sugerir "troca de ecrã".
 */
function emitRuleLines(
  ctx: EmitContext,
  rule: CheckRule,
  checkKey: string,
  status: "fail" | "info" | "warn",
  partExtra: string[],
  repairExtra: string[]
): void {
  let emitted = false;

  if (rule.partCategory && ctx.deviceMatch) {
    const best = pickCached(ctx.partChoice, rule, () =>
      pickBest(
        ctx.parts.filter((p) => p.category === rule.partCategory),
        [...rule.hints, ...partExtra],
        (p) => (p.stockQuantity > 0 ? 1 : 0),
        ctx.deviceHints,
        rule.strictMultiWord ?? false,
        rule.excludeHints ?? [],
        true
      )
    );
    if (best) {
      addLine(ctx.lines, {
        catalogId: best.item.id,
        checkKey,
        confidence: best.confidence,
        inStock: best.item.stockQuantity > 0,
        kind: "part",
        name: best.item.name,
        price: best.item.defaultPrice,
        status,
      });
      emitted = true;
    }
  }

  if (ctx.deviceMatch || !rule.requiresDeviceMatch) {
    const best = pickCached(ctx.repairChoice, rule, () =>
      pickBest(
        ctx.repairs.filter((r) => rule.repairCategories.includes(r.category)),
        [...rule.hints, ...repairExtra],
        undefined,
        ctx.deviceHints,
        rule.strictMultiWord ?? false,
        rule.excludeHints ?? []
      )
    );
    if (best) {
      addLine(ctx.lines, {
        catalogId: best.item.id,
        checkKey,
        confidence: best.confidence,
        inStock: true,
        kind: "repair",
        name: best.item.name,
        price: best.item.defaultPrice,
        status,
      });
      emitted = true;
    }
  }

  if (emitted) {
    ctx.matchedChecks.add(checkKey);
  }
}

/**
 * Constrói o snapshot de pré-orçamento. Determinístico: mesmas entradas →
 * mesma saída (generatedAt é o único campo variável).
 */
export function buildQuoteSuggestion(input: {
  devices: QuoteDeviceInput[];
  diagnostic: QuoteDiagnosticInput;
  parts: QuotePartInput[];
  repairs: QuoteRepairInput[];
}): QuoteSuggestion {
  const generatedAt = new Date().toISOString();
  const diagnostic = input.diagnostic ?? {};
  const results = diagnostic.results ?? {};

  const empty = (
    skippedReason: QuoteSuggestion["skippedReason"]
  ): QuoteSuggestion => ({
    deviceMatch: null,
    generatedAt,
    lines: [],
    skippedReason,
    unmatchedChecks: [],
  });

  if (diagnostic.purpose === "sale") {
    return empty("purpose-sale");
  }

  // Checks acionáveis: só fail/warn alimentam o orçamento.
  const actionable: { key: string; status: "fail" | "warn" }[] = [];
  for (const [key, raw] of Object.entries(results)) {
    const status = checkStatus(raw);
    if (status === "fail" || status === "warn") {
      actionable.push({ key, status });
    }
  }

  // Meta-checks lidos independentemente do status:
  //  - service.template: serviço aplicado no diag (bateria/ecrã → prioridade).
  //  - suggest.parts: labels PT do Grader — hint secundário de nome, nunca
  //    fonte única.
  const templateValue = String(checkValue(results["service.template"]) ?? "")
    .trim()
    .toLowerCase();
  const template = TEMPLATE_RULES[templateValue];
  const suggestRaw = checkValue(results["suggest.parts"]);
  const suggestLabels = (typeof suggestRaw === "string" ? suggestRaw : "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);

  if (actionable.length === 0) {
    return empty("no-fail-warn-checks");
  }

  const { candidates, deviceMatch } = matchDevice(
    diagnostic.device,
    input.devices
  );

  const parts = input.parts.filter((p) => p.isActive !== false);
  const repairs = input.repairs.filter((r) => r.isActive !== false);

  const lines = new Map<string, LineAccumulator>();
  const matchedChecks = new Set<string>();

  // Um atendimento = uma substituição = uma linha: a primeira escolha por
  // CheckRule fica em cache (pickCached) e emits seguintes — outros checks
  // da mesma regra, ou o service.template — reutilizam-na; addLine funde
  // as razões na mesma linha em vez de criar uma segunda com outro
  // candidato.
  const ctx: EmitContext = {
    deviceHints: deviceMatch
      ? [
          ...new Set(
            [deviceMatch.model, ...diagnosticNames(diagnostic.device)]
              .map((n) => normalizeKey(n))
              .filter((n) => n.length >= 3)
          ),
        ]
      : [],
    deviceMatch,
    lines,
    matchedChecks,
    partChoice: new Map(),
    parts,
    repairChoice: new Map(),
    repairs,
  };

  // service.template battery/screen corre PRIMEIRO: o serviço aplicado no
  // diag é o sinal mais forte — os seus hints de repair ("troca de
  // bateria"/"troca de ecrã") escolhem a linha e os checks da mesma regra
  // fundem razões nela (repairChoice/partChoice) em vez de gerar uma
  // segunda linha para a mesma substituição. used/maintenance/whatsapp
  // não chegam aqui (TEMPLATE_RULES só tem battery/screen).
  if (template) {
    emitRuleLines(
      ctx,
      template.rule,
      "service.template",
      "info",
      suggestLabels,
      template.hints
    );
  }

  // Ordem estável: checks ordenados por chave — o JSON preserva a ordem de
  // inserção mas não garantimos que seja a mesma entre envios.
  const ordered = [...actionable].sort((a, b) => compareStr(a.key, b.key));
  for (const { key, status } of ordered) {
    const rule = ruleForCheck(key);
    if (!rule) {
      continue;
    }
    emitRuleLines(ctx, rule, key, status, suggestLabels, []);
  }

  const suggestion: QuoteSuggestion = {
    deviceMatch,
    generatedAt,
    lines: [...lines.values()]
      .map((acc) => {
        const reasonChecks = [...new Set(acc.reasons.map((r) => r.check))];
        const worst = acc.reasons.reduce(
          (w, r) => (STATUS_RANK[r.status] > STATUS_RANK[w] ? r.status : w),
          "info" as "fail" | "info" | "warn"
        );
        return {
          catalogId: acc.catalogId,
          confidence: acc.confidence,
          inStock: acc.inStock,
          kind: acc.kind,
          name: acc.name,
          priceCents: acc.priceCents,
          reasonCheck: reasonChecks.join(", "),
          reasonStatus: worst,
        };
      })
      .sort((a, b) => {
        const kindRank = (k: string) => (k === "repair" ? 0 : 1);
        const kr = kindRank(a.kind) - kindRank(b.kind);
        if (kr !== 0) {
          return kr;
        }
        const nk = normalizeKey(a.name);
        const mk = normalizeKey(b.name);
        if (nk !== mk) {
          return nk < mk ? -1 : 1;
        }
        return compareStr(a.catalogId, b.catalogId);
      }),
    unmatchedChecks: ordered
      .map((a) => a.key)
      .filter((k) => !matchedChecks.has(k)),
  };
  if (candidates.length > 0) {
    suggestion.candidates = candidates;
  }
  return suggestion;
}
