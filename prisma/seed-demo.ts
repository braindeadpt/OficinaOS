/**
 * seed-demo.ts — fictional PT-PT dataset for the public demo
 * (demo.oficinaos.app). Only runs when DEMO_MODE=true.
 *
 * Deterministic: a seeded PRNG picks every value, so two runs with the
 * same `now` produce identical data. Dates are relative to `now` so the
 * shop always looks alive.
 *
 * The dataset is also written as a JSON dump (demo-snapshot.json) — the
 * hourly `bun run demo:reset` truncates every table and restores the dump,
 * then clears uploads. The dump is regenerated on each reset so relative
 * dates stay fresh.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../generated/client";
import {
  assertDemoDatabase,
  DEMO_PASSWORD,
  DEMO_USERNAME,
  isDemoMode,
} from "../server/lib/demo.js";

const DEMO_USER_ID = "demo-user-owner";
const DUMP_PATH =
  process.env.DEMO_DUMP_PATH ?? path.resolve("demo-snapshot.json");
const MILLISECONDS_PER_DAY = 86_400_000;

// ── Seeded RNG (LCG — deterministic, no crypto) ─────────────────────────
const RNG_MODULUS = 4_294_967_296;
let rngState = 20_261_101;
function rand(): number {
  rngState = (rngState * 1_664_525 + 1_013_904_223) % RNG_MODULUS;
  return rngState / RNG_MODULUS;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;

const daysAgo = (now: Date, days: number, hour: number, minute = 0) =>
  new Date(
    now.getTime() -
      days * MILLISECONDS_PER_DAY +
      (hour * 60 + minute) * 60_000 -
      now.getHours() * 3_600_000 -
      now.getMinutes() * 60_000 -
      now.getSeconds() * 1000
  );

// PT NIF: 9 digits with a mod-11 check digit. Fictional but valid-formatted
// — the prefixes (1/2/3 = individuals) plus the check digit are real math,
// the numbers themselves are invented.
function fictionalNif(first: number, seq: number): string {
  const body = `${first}${String(seq).padStart(7, "0")}`;
  const digits = body.split("").map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (9 - i), 0);
  const rem = sum % 11;
  const check = rem < 2 ? 0 : 11 - rem;
  return `${body}${check}`;
}

const CUSTOMER_NAMES = [
  "Mariana Costa",
  "João Ferreira",
  "Ana Rodrigues",
  "Rui Almeida",
  "Carla Nunes",
  "Tiago Pereira",
  "Sofia Martins",
  "Bruno Carvalho",
  "Inês Sousa",
  "Miguel Fonseca",
  "Beatriz Correia",
  "André Teixeira",
  "Carolina Rocha",
  "Diogo Martins",
  "Filipa Araújo",
  "Gonçalo Ribeiro",
  "Helena Cardoso",
  "Ivo Fernandes",
  "Joana Pires",
  "Leonardo Barbosa",
  "Madalena Freitas",
  "Nuno Esteves",
  "Patrícia Neves",
  "Ricardo Tavares",
  "Sara Guerreiro",
  "Tomás Lopes",
  "Vera Antunes",
  "Xavier Baptista",
  "Yara Monteiro",
  "Zélia Figueiredo",
] as const;

const DEVICES: [brand: string, model: string][] = [
  ["Apple", "iPhone 11"],
  ["Apple", "iPhone 12"],
  ["Apple", "iPhone 13"],
  ["Apple", "iPhone 14"],
  ["Apple", "iPhone 15"],
  ["Apple", "iPhone SE (2022)"],
  ["Samsung", "Galaxy A34"],
  ["Samsung", "Galaxy A54"],
  ["Samsung", "Galaxy S23"],
  ["Samsung", "Galaxy S24"],
  ["Samsung", "Galaxy Z Flip5"],
  ["Xiaomi", "Redmi Note 12"],
  ["Xiaomi", "Redmi Note 13"],
  ["Google", "Pixel 8"],
  ["Huawei", "P40"],
];

const PROBLEMS = [
  "Ecrã partido após queda",
  "Bateria descarrega em poucas horas",
  "Não carrega — porta de carga solta",
  "Caiu à água, não liga",
  "Coluna sem som",
  "Câmara traseira tremida",
  "Botão home não responde",
  "Ecrã com mancha verde intermitente",
  "Não passa do logótipo",
  "Microfone não capta em chamadas",
  "Vidro traseiro estalado",
  "Carrega muito devagar",
  "Reinicia sozinho várias vezes ao dia",
  "Tátil com zonas mortas",
  "Sobreaquece durante o carregamento",
  "Sem rede — SIM não detetado",
  "Wi-Fi desliga-se sozinho",
  "Auricular sem som em chamadas",
] as const;

interface RepairDef {
  category: string;
  name: string;
  price: number;
}
const REPAIR_POOL: RepairDef[] = [
  { name: "Substituição de ecrã", category: "HARDWARE", price: 95 },
  { name: "Substituição de ecrã (OLED)", category: "HARDWARE", price: 140 },
  { name: "Substituição de bateria", category: "HARDWARE", price: 39 },
  { name: "Substituição conector de carga", category: "HARDWARE", price: 35 },
  { name: "Substituição de coluna", category: "HARDWARE", price: 30 },
  { name: "Substituição de microfone", category: "HARDWARE", price: 32 },
  { name: "Substituição módulo câmara", category: "HARDWARE", price: 65 },
  { name: "Substituição tampa traseira", category: "HARDWARE", price: 45 },
  {
    name: "Limpeza ultrassons + diagnóstico",
    category: "DIAGNOSTIC",
    price: 40,
  },
  { name: "Reinstalação de firmware", category: "SOFTWARE", price: 25 },
  { name: "Calibração de sensores", category: "SOFTWARE", price: 20 },
  { name: "Diagnóstico de placa", category: "DIAGNOSTIC", price: 30 },
];

interface PartDef {
  category: string;
  name: string;
  price: number;
  reorder: number;
  stock: number;
  supplier: number;
}
const PARTS: PartDef[] = [
  {
    name: "Ecrã iPhone 11 (LCD)",
    category: "SCREEN",
    price: 49.9,
    stock: 3,
    reorder: 2,
    supplier: 0,
  },
  {
    name: "Ecrã iPhone 13 (OLED)",
    category: "SCREEN",
    price: 89.9,
    stock: 4,
    reorder: 2,
    supplier: 0,
  },
  {
    name: "Ecrã iPhone 14",
    category: "SCREEN",
    price: 109.9,
    stock: 2,
    reorder: 2,
    supplier: 0,
  },
  {
    name: "Ecrã Samsung Galaxy A54",
    category: "SCREEN",
    price: 64.9,
    stock: 3,
    reorder: 2,
    supplier: 1,
  },
  {
    name: "Ecrã Xiaomi Redmi Note 13",
    category: "SCREEN",
    price: 39.9,
    stock: 2,
    reorder: 2,
    supplier: 1,
  },
  {
    name: "Bateria iPhone 12",
    category: "BATTERY",
    price: 24.9,
    stock: 6,
    reorder: 3,
    supplier: 0,
  },
  {
    name: "Bateria Samsung Galaxy S23",
    category: "BATTERY",
    price: 29.9,
    stock: 1,
    reorder: 2,
    supplier: 2,
  },
  {
    name: "Bateria Huawei P40",
    category: "BATTERY",
    price: 27.9,
    stock: 0,
    reorder: 2,
    supplier: 2,
  },
  {
    name: "Conector de carga USB-C",
    category: "CHARGING_PORT",
    price: 12.5,
    stock: 8,
    reorder: 3,
    supplier: 1,
  },
  {
    name: "Câmara traseira iPhone 13",
    category: "CAMERA",
    price: 45.0,
    stock: 1,
    reorder: 1,
    supplier: 0,
  },
  {
    name: "Coluna Galaxy A34",
    category: "SPEAKER",
    price: 9.9,
    stock: 5,
    reorder: 2,
    supplier: 1,
  },
  {
    name: "Película vidro temperado",
    category: "OTHER",
    price: 4.9,
    stock: 25,
    reorder: 10,
    supplier: 2,
  },
  {
    name: "Capa silicone iPhone 14",
    category: "OTHER",
    price: 6.9,
    stock: 12,
    reorder: 5,
    supplier: 2,
  },
  {
    name: "Carregador 20W USB-C",
    category: "OTHER",
    price: 11.9,
    stock: 0,
    reorder: 3,
    supplier: 1,
  },
];

const SUPPLIERS = [
  {
    name: "TechParts Lisboa, Lda.",
    email: "encomendas@techparts.example",
    phone: "218 000 000",
    taxId: fictionalNif(5, 104_210),
    address: "Parque Industrial do Alto, Lote 14, Lisboa",
  },
  {
    name: "IberFone Distribuição",
    email: "geral@iberfone.example",
    phone: "220 000 000",
    taxId: fictionalNif(5, 308_775),
    address: "Zona Industrial do Porto, Arm. 7, Maia",
  },
  {
    name: "MobileFix Supplies, Unipessoal Lda",
    email: "vendas@mobilefix.example",
    phone: "239 000 000",
    taxId: fictionalNif(5, 512_340),
    address: "Rua do Comércio 88, Coimbra",
  },
];

const REPAIR_CATALOG: RepairDef[] = [
  { name: "Substituição de ecrã", category: "HARDWARE", price: 79.9 },
  { name: "Substituição de bateria", category: "HARDWARE", price: 34.9 },
  { name: "Substituição conector de carga", category: "HARDWARE", price: 34.9 },
  { name: "Limpeza + diagnóstico", category: "DIAGNOSTIC", price: 29.9 },
  { name: "Reinstalação de firmware", category: "SOFTWARE", price: 24.9 },
  { name: "Substituição de coluna", category: "HARDWARE", price: 29.9 },
  { name: "Substituição de microfone", category: "HARDWARE", price: 29.9 },
  { name: "Substituição módulo câmara", category: "HARDWARE", price: 59.9 },
];

const NOTES = [
  "Cliente pediu contacto por SMS, não atende chamadas.",
  "Equipamento com película aplicada — cuidado ao abrir.",
  "Peça de origem diferente do previsto — confirmar referência.",
  "Cliente volta no sábado para levantar.",
  "Verificar Face ID depois da substituição do ecrã.",
  "Capa protetora entregue junto com o equipamento.",
] as const;

type Row = Record<string, unknown>;
export type DemoDump = [delegate: string, rows: Row[]][];

/** The FK-ordered set of tables the demo seeds (dump order = restore order). */
const DUMP_ORDER = [
  "user",
  "account",
  "shopSettings",
  "brand",
  "device",
  "customer",
  "supplier",
  "partsCatalog",
  "job",
  "jobRepair",
  "jobPart",
  "jobPartsWaiting",
  "jobQuote",
  "jobNote",
  "payment",
  "sale",
  "saleItem",
  "salePayment",
  "intakeRequest",
  "repairCatalog",
  "notificationTemplate",
  "auditLog",
  "jobCounter",
  "saleCounter",
  "intakeRequestCounter",
] as const;

type Push = (delegate: string, row: Row) => void;
const stamp = (d: Date) => ({ createdAt: d, updatedAt: d });
// Job children, payments and sales have no updatedAt column.
const createdStamp = (d: Date) => ({ createdAt: d });
const id = (p: string, n: number) => `${p}-${String(n).padStart(3, "0")}`;

// jobCode format matches generateJobCode (REP-YYYY-NNNNNN-XXX) but the
// suffix is deterministic — no crypto randomness in a seeded dataset.
const jobCodeFor = (seq: number, year: number) =>
  `REP-${year}-${String(seq).padStart(6, "0")}-DEM`;
const accessCodeFor = (seq: number) => `demo${String(seq).padStart(28, "0")}`;

function demoDeposit(status: string, total: number | null): number | null {
  if (status !== "IN_REPAIR" && status !== "WAITING_FOR_PARTS") {
    return null;
  }
  return chance(0.3) ? Math.round((total ?? 50) * 0.25) : null;
}

function buildUser(push: Push, createdSeed: Date, passwordHash: string) {
  push("user", {
    id: DEMO_USER_ID,
    name: "Rui Andrade",
    username: DEMO_USERNAME,
    displayUsername: DEMO_USERNAME,
    email: "demo@oficinaos.example",
    emailVerified: true,
    role: "OWNER",
    isActive: true,
    mustChangePassword: false,
    ...stamp(createdSeed),
  });
  push("account", {
    id: "demo-account-owner",
    userId: DEMO_USER_ID,
    accountId: DEMO_USER_ID,
    providerId: "credential",
    password: passwordHash,
    ...stamp(createdSeed),
  });
}

function buildShopSettings(push: Push, createdSeed: Date) {
  push("shopSettings", {
    id: "default",
    shopName: "TecnoReparo Amadora — Loja Demo",
    address: "Rua da Oficina 12, 2700-000 Amadora",
    phone: "210 000 000",
    countryCode: "PT",
    currency: "EUR",
    defaultWarrantyDays: 90,
    receiptFooter:
      "Obrigado pela preferência — TecnoReparo (dados de demonstração)",
    monthlyRevenueGoal: 4500,
    whatsappEnabled: false,
    ...stamp(createdSeed),
  });
}

function buildBrandsDevices(push: Push, createdSeed: Date): string[] {
  const brandIds = new Map<string, string>();
  for (const [brand] of DEVICES) {
    if (!brandIds.has(brand)) {
      brandIds.set(brand, `demo-brand-${brand.toLowerCase()}`);
    }
  }
  for (const [name, bid] of brandIds) {
    push("brand", { id: bid, name, ...stamp(createdSeed) });
  }
  const deviceIds: string[] = [];
  DEVICES.forEach(([brand, model], i) => {
    const did = id("demo-dev", i + 1);
    deviceIds.push(did);
    push("device", {
      id: did,
      brandId: brandIds.get(brand),
      model,
      category: "phone",
      ...stamp(createdSeed),
    });
  });
  return deviceIds;
}

function buildCustomers(push: Push, now: Date) {
  CUSTOMER_NAMES.forEach((name, i) => {
    // Obviously fictional but format-valid: 91/93 000 0NNN. No real
    // subscriber ever sits in the 000 0xxx range.
    const mobile = `${i % 2 === 0 ? "91" : "93"} 000 0${String(i + 1).padStart(3, "0")}`;
    const [firstRaw, lastRaw] = name.split(" ");
    const first = firstRaw.toLowerCase().replace(/[^a-z]/g, "");
    const last = (lastRaw ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const hasEmail = chance(0.6);
    const consented = chance(0.45);
    push("customer", {
      id: id("demo-cust", i + 1),
      name,
      phone: mobile,
      email: hasEmail ? `${first}.${last}@exemplo.example` : null,
      taxId: fictionalNif(pick([1, 2, 3]), 100_000 + i * 97),
      whatsappConsent: consented,
      whatsappConsentAt: consented ? daysAgo(now, int(20, 80), 11) : null,
      ...stamp(daysAgo(now, int(30, 85), 10)),
    });
  });
}

function buildSuppliersParts(push: Push, createdSeed: Date): string[] {
  const supplierIds: string[] = [];
  SUPPLIERS.forEach((s, i) => {
    const sid = `demo-sup-${i + 1}`;
    supplierIds.push(sid);
    push("supplier", { id: sid, ...s, isActive: true, ...stamp(createdSeed) });
  });
  const partIds: string[] = [];
  PARTS.forEach((p, i) => {
    const pid = id("demo-part", i + 1);
    partIds.push(pid);
    push("partsCatalog", {
      id: pid,
      name: p.name,
      category: p.category,
      defaultPrice: p.price,
      supplier: SUPPLIERS[p.supplier].name,
      supplierId: supplierIds[p.supplier],
      stockQuantity: p.stock,
      reorderLevel: p.reorder,
      isActive: true,
      ...stamp(createdSeed),
    });
  });
  return partIds;
}

function buildRepairCatalog(push: Push, createdSeed: Date) {
  REPAIR_CATALOG.forEach((r, i) => {
    push("repairCatalog", {
      id: id("demo-repcat", i + 1),
      name: r.name,
      category: r.category,
      defaultPrice: r.price,
      isActive: true,
      ...stamp(createdSeed),
    });
  });
}

function buildTemplates(push: Push, createdSeed: Date) {
  const TEMPLATES: [name: string, body: string][] = [
    [
      "job_created",
      "Nova reparação registada{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} para {{customerName}}{{endif}}",
    ],
    [
      "job_done",
      "Reparação concluída{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
    ],
    [
      "job_in_repair",
      "Reparação em curso{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
    ],
    [
      "job_waiting_parts",
      "A aguardar peças{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
    ],
    [
      "job_delivered",
      "Aparelho entregue{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} a {{customerName}}{{endif}}",
    ],
    [
      "job_on_hold",
      "Reparação em pausa{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
    ],
    [
      "job_returned",
      "Aparelho devolvido{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} a {{customerName}}{{endif}}",
    ],
    [
      "job_cancelled",
      "Reparação cancelada{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
    ],
    ["job_overdue", "Reparação atrasada{{if jobCode}} — {{jobCode}}{{endif}}"],
    [
      "quote_sent",
      "Orçamento enviado{{if jobCode}} — {{jobCode}}{{endif}}{{if quoteAmount}} ({{quoteAmount}} {{currency}}){{endif}}",
    ],
    [
      "pre_check_submitted",
      "Novo pedido de pré-diagnóstico{{if requestCode}} — {{requestCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}{{if deviceLabel}} ({{deviceLabel}}){{endif}}",
    ],
    [
      "part_low_stock",
      "Stock baixo: {{partName}} — {{partQuantity}} unidades (nível de encomenda {{partReorderLevel}})",
    ],
  ];
  TEMPLATES.forEach(([name, body], i) => {
    push("notificationTemplate", {
      id: id("demo-tpl", i + 1),
      name,
      channel: "IN_APP",
      body,
      isDefault: true,
      ...stamp(createdSeed),
    });
  });

  // Customer-facing templates. Without these the demo settings screen had
  // only IN_APP rows and both the WhatsApp and SMS groups looked empty.
  const CHANNEL_TEMPLATES: [
    name: string,
    channel: "WHATSAPP" | "SMS",
    body: string,
  ][] = [
    [
      "job_ready",
      "WHATSAPP",
      "Olá {{customerName}}, a sua reparação {{jobCode}} está pronta para levantar.{{if shopName}} — {{shopName}}{{endif}}",
    ],
    [
      "job_delivered",
      "WHATSAPP",
      "Olá {{customerName}}, obrigado pela preferência. A reparação {{jobCode}} foi entregue.{{if reviewUrl}}\nDeixe a sua avaliação: {{reviewUrl}}{{endif}}",
    ],
    [
      "quote_sent",
      "WHATSAPP",
      "Olá {{customerName}}, o orçamento da reparação {{jobCode}} está pronto: {{quoteAmount}} {{currency}}.{{if trackingUrl}}\nConsulte aqui: {{trackingUrl}}{{endif}}",
    ],
    [
      "job_ready",
      "SMS",
      "{{shopName}}: reparação {{jobCode}} pronta para levantar.",
    ],
    [
      "job_overdue",
      "SMS",
      "{{shopName}}: a reparação {{jobCode}} está atrasada. Entraremos em contacto.",
    ],
  ];
  CHANNEL_TEMPLATES.forEach(([name, channel, body], i) => {
    push("notificationTemplate", {
      id: `demo-tpl-${channel.toLowerCase()}-${i + 1}`,
      name,
      channel,
      body,
      isDefault: true,
      ...stamp(createdSeed),
    });
  });
}

interface Counters {
  audit: number;
  note: number;
  part: number;
  pay: number;
  quote: number;
  repair: number;
  wait: number;
}

interface JobCtx {
  ageMax: number;
  ageMin: number;
  counters: Counters;
  created: Date;
  jid: string;
  now: Date;
  partIds: string[];
  repairs: RepairDef[];
  status: string;
  total: number | null;
  usedPart: { idx: number; qty: number } | null;
  workDays: number;
}

function pushJobChildren(push: Push, ctx: JobCtx) {
  const {
    jid,
    status,
    created,
    now,
    ageMin,
    ageMax,
    workDays,
    total,
    repairs,
    usedPart,
    partIds,
    counters,
  } = ctx;
  const deliveredAgo =
    status === "DELIVERED" || status === "RETURNED"
      ? Math.max(0, int(ageMin, ageMax) - workDays)
      : null;

  push("auditLog", {
    id: id("demo-audit", ++counters.audit),
    jobId: jid,
    userId: DEMO_USER_ID,
    action: "JOB_CREATED",
    toValue: "INTAKE",
    createdAt: created,
  });
  for (const r of repairs) {
    push("jobRepair", {
      id: id("demo-jr", ++counters.repair),
      jobId: jid,
      repairName: r.name,
      category: r.category,
      price: r.price,
      createdById: DEMO_USER_ID,
      ...createdStamp(created),
    });
  }
  if (usedPart) {
    const p = PARTS[usedPart.idx];
    push("jobPart", {
      id: id("demo-jp", ++counters.part),
      jobId: jid,
      partId: partIds[usedPart.idx],
      partName: p.name,
      category: p.category,
      unitPrice: p.price,
      quantity: usedPart.qty,
      totalCost: p.price * usedPart.qty,
      createdById: DEMO_USER_ID,
      ...createdStamp(created),
    });
  }
  if (status === "WAITING_FOR_PARTS") {
    push("jobPartsWaiting", {
      id: id("demo-jw", ++counters.wait),
      jobId: jid,
      partName: pick(PARTS).name,
      supplier: pick(SUPPLIERS).name,
      ...createdStamp(created),
    });
  }
  if (status !== "INTAKE" && chance(0.45)) {
    const sent = daysAgo(now, Math.max(0, int(ageMin, ageMax) - 1), 14);
    const qStatus =
      status === "ON_HOLD"
        ? "SENT"
        : pick(["APPROVED", "APPROVED", "REJECTED"]);
    push("jobQuote", {
      id: id("demo-jq", ++counters.quote),
      jobId: jid,
      version: 1,
      amount: total ?? int(25, 160),
      note: chance(0.4) ? pick(NOTES) : null,
      status: qStatus,
      sentAt: sent,
      respondedAt:
        qStatus === "SENT"
          ? null
          : daysAgo(now, Math.max(0, int(ageMin, ageMax) - 1), 17),
    });
  }
  if (chance(0.3)) {
    push("jobNote", {
      id: id("demo-jn", ++counters.note),
      jobId: jid,
      content: pick(NOTES),
      isCustomerVisible: false,
      createdById: DEMO_USER_ID,
      ...createdStamp(created),
    });
  }
  if (status === "DELIVERED") {
    const paidAt = daysAgo(now, deliveredAgo ?? 0, int(16, 19));
    push("payment", {
      id: id("demo-pay", ++counters.pay),
      jobId: jid,
      method: pick(["MB_WAY", "CARD", "CASH", "TRANSFER"]),
      amount: total ?? int(25, 160),
      createdById: DEMO_USER_ID,
      createdAt: paidAt,
    });
    push("auditLog", {
      id: id("demo-audit", ++counters.audit),
      jobId: jid,
      userId: DEMO_USER_ID,
      action: "STATUS_CHANGED",
      fromValue: "DONE",
      toValue: "DELIVERED",
      createdAt: paidAt,
    });
  }
  if (status === "RETURNED") {
    push("auditLog", {
      id: id("demo-audit", ++counters.audit),
      jobId: jid,
      userId: DEMO_USER_ID,
      action: "STATUS_CHANGED",
      fromValue: "DELIVERED",
      toValue: "RETURNED",
      createdAt: daysAgo(now, deliveredAgo ?? 0, 15),
    });
  }
}

type StatusPlan = [
  status: string,
  count: number,
  ageMin: number,
  ageMax: number,
];
const STATUS_PLAN: StatusPlan[] = [
  ["DELIVERED", 20, 2, 45],
  ["DONE", 8, 0, 3],
  ["IN_REPAIR", 13, 0, 4],
  ["WAITING_FOR_PARTS", 6, 2, 9],
  ["ON_HOLD", 5, 1, 6],
  ["INTAKE", 6, 0, 1],
  ["RETURNED", 1, 7, 20],
  ["CANCELLED", 1, 5, 15],
];

function buildJob(
  push: Push,
  seq: number,
  year: number,
  now: Date,
  deviceIds: string[],
  partIds: string[],
  counters: Counters,
  plan: StatusPlan
) {
  const [status, , ageMin, ageMax] = plan;
  const jid = id("demo-job", seq);
  const custIdx = int(0, CUSTOMER_NAMES.length - 1);
  const devIdx = int(0, deviceIds.length - 1);
  const created = daysAgo(now, int(ageMin, ageMax), int(8, 19), int(0, 59));
  const workDays = int(1, 4);
  const repairsCount = status === "INTAKE" ? 0 : int(1, 2);
  const repairs = Array.from({ length: repairsCount }, () => pick(REPAIR_POOL));
  const usedPart =
    repairsCount > 0 && chance(0.7)
      ? { idx: int(0, PARTS.length - 1), qty: 1 }
      : null;
  const repairsTotal = repairs.reduce((s, r) => s + r.price, 0);
  const partsTotal = usedPart ? PARTS[usedPart.idx].price * usedPart.qty : 0;
  const total = repairsTotal + partsTotal || null;
  const deliveredAgo =
    status === "DELIVERED" || status === "RETURNED"
      ? Math.max(0, int(ageMin, ageMax) - workDays)
      : null;

  push("job", {
    id: jid,
    jobCode: jobCodeFor(seq, year),
    accessCode: accessCodeFor(seq),
    customerId: id("demo-cust", custIdx + 1),
    deviceId: deviceIds[devIdx],
    reportedProblem: pick(PROBLEMS),
    status,
    isUrgent: chance(0.15),
    estimatedCost: total,
    depositAmount: demoDeposit(status, total),
    estimatedDate: daysAgo(now, int(ageMin, ageMax) - workDays, 18),
    createdById: DEMO_USER_ID,
    technicianId: DEMO_USER_ID,
    ...(status === "DELIVERED" && chance(0.35)
      ? {
          invoiceDocType: "FR",
          invoiceNumber: `FR D/2026/${seq}`,
          invoicedAt: daysAgo(now, deliveredAgo ?? 0, 18),
        }
      : {}),
    ...stamp(created),
  });

  pushJobChildren(push, {
    jid,
    status,
    created,
    now,
    ageMin,
    ageMax,
    workDays,
    total,
    repairs,
    usedPart,
    partIds,
    counters,
  });
}

function buildJobs(
  push: Push,
  now: Date,
  deviceIds: string[],
  partIds: string[]
): number {
  const year = now.getFullYear();
  const counters: Counters = {
    pay: 0,
    part: 0,
    repair: 0,
    quote: 0,
    note: 0,
    wait: 0,
    audit: 0,
  };
  let jobSeq = 0;

  for (const plan of STATUS_PLAN) {
    for (let k = 0; k < plan[1]; k++) {
      jobSeq += 1;
      buildJob(push, jobSeq, year, now, deviceIds, partIds, counters, plan);
    }
  }
  push("jobCounter", { year, lastSeq: jobSeq });
  return jobSeq;
}

function buildSales(push: Push, now: Date, partIds: string[]): number {
  const year = now.getFullYear();
  let saleSeq = 0;
  let saleItemSeq = 0;
  let salePaySeq = 0;
  const accessoryIdx = PARTS.map((_p, i) => i).filter(
    (i) => PARTS[i].category === "OTHER"
  );
  for (let s = 0; s < 10; s++) {
    saleSeq += 1;
    const sid = id("demo-sale", saleSeq);
    const at = daysAgo(now, int(0, 14), int(10, 19));
    const itemCount = int(1, 2);
    const items = Array.from({ length: itemCount }, () => {
      const pi = pick(accessoryIdx);
      return { idx: pi, qty: int(1, 2), price: PARTS[pi].price * 2 };
    });
    const total = items.reduce((t, i) => t + i.price * i.qty, 0);
    push("sale", {
      id: sid,
      saleCode: `VND-${year}-${String(saleSeq).padStart(6, "0")}-DEM`,
      customerId: chance(0.7)
        ? id("demo-cust", int(1, CUSTOMER_NAMES.length))
        : null,
      total,
      createdById: DEMO_USER_ID,
      ...createdStamp(at),
    });
    for (const it of items) {
      push("saleItem", {
        id: id("demo-si", ++saleItemSeq),
        saleId: sid,
        partId: partIds[it.idx],
        name: PARTS[it.idx].name,
        category: PARTS[it.idx].category,
        unitPrice: it.price,
        quantity: it.qty,
        lineTotal: it.price * it.qty,
      });
    }
    push("salePayment", {
      id: id("demo-sp", ++salePaySeq),
      saleId: sid,
      method: pick(["MB_WAY", "CARD", "CASH"]),
      amount: total,
      ...createdStamp(at),
    });
  }
  push("saleCounter", { year, lastSeq: saleSeq });
  return saleSeq;
}

function buildIntakeRequests(push: Push, now: Date): number {
  const pendingNames = ["Mário Lages", "Cátia Verdasca", "Pedro Homen"];
  const year = now.getFullYear();
  let intakeSeq = 0;
  for (const [i, name] of pendingNames.entries()) {
    intakeSeq += 1;
    const at = daysAgo(now, 0, 9 + i * 2);
    push("intakeRequest", {
      id: id("demo-intake", intakeSeq),
      code: `PC-${year}-${String(intakeSeq).padStart(4, "0")}`,
      customerName: name,
      customerPhone: `93 000 0${String(100 + i).padStart(3, "0")}`,
      customerEmail: chance(0.5)
        ? `${name.split(" ")[0].toLowerCase()}@exemplo.example`
        : null,
      deviceLabel: pick(DEVICES).join(" "),
      problem: pick(PROBLEMS),
      whatsappOptIn: chance(0.5),
      status: "PENDING",
      ...stamp(at),
    });
  }
  push("intakeRequestCounter", {
    year,
    lastSeq: intakeSeq,
  });
  return intakeSeq;
}

/**
 * Builds the whole dataset as plain Prisma create inputs — deterministic
 * given `now` because every random pick comes from the seeded RNG.
 */
export async function buildDemoDump(now: Date): Promise<DemoDump> {
  // Re-seed on every call so the dataset is a pure function of `now`.
  rngState = 20_261_101;
  const tables = new Map<string, Row[]>();
  const push: Push = (delegate, row) => {
    const list = tables.get(delegate) ?? [];
    list.push(row);
    tables.set(delegate, list);
  };

  const createdSeed = daysAgo(now, 90, 10);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  buildUser(push, createdSeed, passwordHash);
  buildShopSettings(push, createdSeed);
  const deviceIds = buildBrandsDevices(push, createdSeed);
  buildCustomers(push, now);
  const partIds = buildSuppliersParts(push, createdSeed);
  buildRepairCatalog(push, createdSeed);
  buildJobs(push, now, deviceIds, partIds);
  buildSales(push, now, partIds);
  buildIntakeRequests(push, now);
  buildTemplates(push, createdSeed);

  return DUMP_ORDER.map(
    (delegate) => [delegate, tables.get(delegate) ?? []] as [string, Row[]]
  );
}

interface DemoDelegate {
  createMany: (arg: { data: Row[] }) => Promise<unknown>;
  findMany: (arg?: { select?: Record<string, boolean> }) => Promise<Row[]>;
}

type DemoPrisma = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(
    sql: string,
    ...params: unknown[]
  ) => Promise<T>;
  $transaction: (
    fn: (tx: DemoPrisma) => Promise<unknown>,
    opts?: { timeout?: number; maxWait?: number }
  ) => Promise<unknown>;
} & Record<string, DemoDelegate>;

/**
 * Wipes every public table except _prisma_migrations and replays the dump
 * in FK order — inside ONE transaction so the app never serves a
 * half-empty database. lock_timeout keeps a stuck lock from freezing
 * reads; the 60s timeout aborts rather than hold the truncate forever.
 * Used by `bun run db:seed:demo`, the hourly `demo:reset` and the
 * first-boot seed — idempotent.
 */
export async function applyDemoDump(
  prisma: DemoPrisma,
  dump: DemoDump
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
      // The hourly TRUNCATE would log every visitor out — preserve live
      // sessions and re-insert them after the replay (the demo user's id
      // is deterministic, so the FK still resolves).
      const sessions = await tx.session.findMany();
      const tables = await tx.$queryRawUnsafe<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
      );
      if (tables.length > 0) {
        const list = tables.map((t) => `"${t.tablename}"`).join(", ");
        await tx.$executeRawUnsafe(
          `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`
        );
      }
      for (const [delegate, rows] of dump) {
        if (rows.length > 0) {
          await tx[delegate].createMany({ data: rows });
        }
      }
      if (sessions.length > 0) {
        const userIds = new Set(
          (await tx.user.findMany({ select: { id: true } })).map(
            (u) => u.id as string
          )
        );
        const restorable = sessions.filter((s) =>
          userIds.has(s.userId as string)
        );
        if (restorable.length > 0) {
          await tx.session.createMany({ data: restorable });
        }
      }
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}

export async function writeDemoDump(dump: DemoDump): Promise<string> {
  await writeFile(DUMP_PATH, JSON.stringify(dump));
  return DUMP_PATH;
}

export async function seedDemo(prisma: DemoPrisma): Promise<DemoDump> {
  // Second guard beyond DEMO_MODE: the seed wipes the database, so the
  // connection must point at a database whose name says "demo" — a
  // misconfigured DATABASE_URL can never truncate a real shop.
  assertDemoDatabase(process.env.DATABASE_URL ?? "");
  const dump = await buildDemoDump(new Date());
  await applyDemoDump(prisma, dump);
  await writeDemoDump(dump);
  return dump;
}

async function main() {
  if (!isDemoMode()) {
    throw new Error(
      "seed-demo only runs with DEMO_MODE=true — it wipes the whole database."
    );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const dump = await seedDemo(prisma as unknown as DemoPrisma);
    const total = dump.reduce((s, [, rows]) => s + rows.length, 0);
    console.log(`demo seed ok — ${total} rows, dump at ${DUMP_PATH}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
