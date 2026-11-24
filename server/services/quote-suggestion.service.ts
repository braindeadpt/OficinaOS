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
  hints: string[];
  partCategory?: PartCategoryType;
  repairCategories: RepairCategoryType[];
  /** true = a linha só sai com deviceMatch (hardware). */
  requiresDeviceMatch: boolean;
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
 * A direcção do contains depende da especificidade do hint: palavras
 * simples («bateria», «coluna») aceitam os dois sentidos — «Bateria
 * iPhone 15» contém «bateria» e «bateria» contém-se a si. Expressões
 * multi-palavra («speaker de chamadas», «altifalante superior») identificam
 * um componente concreto e só contam quando o NOME DO ITEM as contém —
 * aceitar o inverso («Speaker» contido em «speaker de chamadas») sugeria
 * a coluna como auricular (BUG #166 r2).
 */
function matchConfidence(
  norm: string,
  hints: string[]
): QuoteConfidence | null {
  let confidence: QuoteConfidence | null = null;
  for (const hint of hints) {
    if (norm === hint) {
      return "high";
    }
    const specific = hint.includes(" ");
    if (norm.includes(hint) || (!specific && hint.includes(norm))) {
      confidence = "low";
    }
  }
  return confidence;
}

/**
 * Contains por palavra inteira sobre strings normalizadas (separadas por
 * espaços): evita falsos positivos tipo "pro" dentro de "protetor".
 */
function termContained(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Ordem de preferência entre dois candidatos — sempre determinístico:
 *  1. rank: igualdade EXATA de hint (equals) > contains. O deviceHit NÃO
 *     promove um contains a equals — ex.: "Troca de bateria" (exato do
 *     template) ganha a "Troca de bateria iPhone 15" (contains+deviceHit).
 *  2. deviceHit: entre não-exatos, o item que menciona o modelo do
 *     aparelho ganha (compatibilidade por nome — ver pickBest).
 *  3. stock>0 (peças), depois nome normalizado, depois id.
 */
function isPreferred<T extends { id: string; name: string }>(
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
 * Melhor candidato de um pool para os hints dados. Empates desempatados por
 * isPreferred — determinístico.
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
  deviceHints: string[] = []
): ScoredCandidate<T> | null {
  const normalizedHints = hints
    .map((h) => normalizeKey(h))
    .filter((h) => h.length > 0);
  const normalizedDeviceHints = deviceHints.filter((h) => h.length > 0);
  let best: ScoredCandidate<T> | null = null;

  for (const item of pool) {
    const norm = normalizeKey(item.name);
    if (!norm) {
      continue;
    }
    const matched = matchConfidence(norm, normalizedHints);
    if (!matched) {
      continue;
    }
    const deviceHit = normalizedDeviceHints.some(
      (h) => termContained(norm, h) || termContained(h, norm)
    );
    const candidate: ScoredCandidate<T> = {
      // confidence de exibição: exact ou deviceHit → "high". O rank, em
      // contraste, reflete SÓ a igualdade exata — deviceHit nunca promove
      // um contains a equals na ordenação (isPreferred).
      confidence: deviceHit ? "high" : matched,
      deviceHit,
      item,
      norm,
      rank: matched === "high" ? 2 : 1,
      stock: stockOf ? stockOf(item) : 0,
    };
    if (!best || isPreferred(candidate, best)) {
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
        ctx.deviceHints
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
        ctx.deviceHints
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
