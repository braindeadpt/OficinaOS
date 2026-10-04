import type { PrismaClient } from "@generated/client";
import type { OrdersReportDTO } from "@shared/types/reports";
import QRCode from "qrcode";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";

export async function generateTrackingQr(
  jobCode: string,
  baseUrl: string,
  phone4?: string
): Promise<Buffer | null> {
  if (!baseUrl) {
    return null;
  }
  const query = phone4 ? `?phone4=${encodeURIComponent(phone4)}` : "";
  return await QRCode.toBuffer(`${baseUrl}/tracking/${jobCode}${query}`, {
    type: "png",
    width: 200,
  });
}

export function phone4Of(phone: string | null | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escMultiline(s: string): string {
  return esc(s).replace(/\r?\n/g, "<br>");
}

export function fmtMoney(
  v: number | { toNumber: () => number },
  currency = "EUR"
): string {
  const n = typeof v === "number" ? v : v.toNumber();
  return `${n.toLocaleString("en-US")} ${currency}`;
}

export const toNum = (v: number | { toNumber: () => number }) =>
  typeof v === "number" ? v : v.toNumber();

export interface ReceiptStrings {
  balanceDue: string;
  customer: string;
  dateLocale: string;
  device: string;
  items: string;
  job: string;
  label: string;
  paid: string;
  paidDeposit: string;
  paymentMethods: Record<string, string>;
  phone: string;
  problem: string;
  qrUnavailable: string;
  qty: string;
  receipt: string;
  sale: string;
  scanQr: string;
  servedBy: string;
  signatureLabel: string;
  termsSigned: string;
  total: string;
  warranty: string;
  warrantyDays: string;
  warrantyUntil: string;
}

const RECEIPT_STRINGS: Record<string, ReceiptStrings> = {
  pt: {
    balanceDue: "Por pagar",
    customer: "Cliente",
    dateLocale: "pt-PT",
    device: "Equipamento",
    items: "Itens",
    job: "Reparação",
    label: "Etiqueta",
    paid: "Pago",
    paidDeposit: "Pago (sinal)",
    paymentMethods: {
      CARD: "Cartão",
      CASH: "Numerário",
      OTHER: "Outro",
      TRANSFER: "Transferência",
    },
    phone: "Telefone",
    problem: "Problema",
    qrUnavailable: "QR indisponível — configurar APP_URL",
    qty: "Qtd",
    receipt: "Recibo",
    sale: "Venda",
    scanQr: "Leia o código QR para acompanhar a sua reparação",
    servedBy: "Atendido por",
    signatureLabel: "Assinatura do cliente",
    termsSigned:
      "Declaro que o equipamento descrito é meu e aceito os termos de reparação da loja.",
    total: "Total",
    warranty: "Garantia",
    warrantyDays: "{days} dias",
    warrantyUntil: "até {date}",
  },
  en: {
    balanceDue: "Balance due",
    customer: "Customer",
    dateLocale: "en-GB",
    device: "Device",
    items: "Items",
    job: "Job",
    label: "Label",
    paid: "Paid",
    paidDeposit: "Paid (deposit)",
    paymentMethods: {
      CARD: "Card",
      CASH: "Cash",
      OTHER: "Other",
      TRANSFER: "Transfer",
    },
    phone: "Phone",
    problem: "Problem",
    qrUnavailable: "QR unavailable — configure APP_URL",
    qty: "Qty",
    receipt: "Receipt",
    sale: "Sale",
    scanQr: "Scan QR to track your repair",
    servedBy: "Served by",
    signatureLabel: "Customer signature",
    termsSigned:
      "I declare the described device is mine and accept the shop's repair terms.",
    total: "Total",
    warranty: "Warranty",
    warrantyDays: "{days} days",
    warrantyUntil: "until {date}",
  },
  fr: {
    balanceDue: "Reste à payer",
    customer: "Client",
    dateLocale: "fr-FR",
    device: "Appareil",
    items: "Articles",
    job: "Réparation",
    label: "Étiquette",
    paid: "Payé",
    paidDeposit: "Payé (acompte)",
    paymentMethods: {
      CARD: "Carte",
      CASH: "Espèces",
      OTHER: "Autre",
      TRANSFER: "Virement",
    },
    phone: "Téléphone",
    problem: "Problème",
    qrUnavailable: "QR indisponible — configurer APP_URL",
    qty: "Qté",
    receipt: "Reçu",
    sale: "Vente",
    scanQr: "Scannez le QR pour suivre votre réparation",
    servedBy: "Servi par",
    signatureLabel: "Signature du client",
    termsSigned:
      "Je déclare que l'appareil décrit m'appartient et j'accepte les conditions de réparation.",
    total: "Total",
    warranty: "Garantie",
    warrantyDays: "{days} jours",
    warrantyUntil: "jusqu'au {date}",
  },
  es: {
    balanceDue: "Pendiente de pago",
    customer: "Cliente",
    dateLocale: "es-ES",
    device: "Dispositivo",
    items: "Artículos",
    job: "Reparación",
    label: "Etiqueta",
    paid: "Pagado",
    paidDeposit: "Pagado (anticipo)",
    paymentMethods: {
      CARD: "Tarjeta",
      CASH: "Efectivo",
      OTHER: "Otro",
      TRANSFER: "Transferencia",
    },
    phone: "Teléfono",
    problem: "Problema",
    qrUnavailable: "QR no disponible — configurar APP_URL",
    qty: "Cant.",
    receipt: "Recibo",
    sale: "Venta",
    scanQr: "Escanea el QR para seguir tu reparación",
    servedBy: "Atendido por",
    signatureLabel: "Firma del cliente",
    termsSigned:
      "Declaro que el dispositivo descrito es mío y acepto las condiciones de reparación.",
    total: "Total",
    warranty: "Garantía",
    warrantyDays: "{days} días",
    warrantyUntil: "hasta el {date}",
  },
};

export function receiptStrings(locale?: string): ReceiptStrings {
  return RECEIPT_STRINGS[locale ?? ""] ?? RECEIPT_STRINGS.pt;
}

// ── Print preferences (ShopSettings) ────────────────────────────────────
type ReceiptPaper = "58mm" | "80mm" | "a4";
type LabelSize = "40x20" | "57x32" | "62x29";

interface PrintPrefs {
  labelSize: LabelSize;
  paper: ReceiptPaper;
  showImei: boolean;
  showProblem: boolean;
  showQr: boolean;
  showSignature: boolean;
  showWarranty: boolean;
}

interface PrintSettingsRow {
  labelSize?: string | null;
  receiptPaper?: string | null;
  receiptShowImei?: boolean | null;
  receiptShowProblem?: boolean | null;
  receiptShowQr?: boolean | null;
  receiptShowSignature?: boolean | null;
  receiptShowWarranty?: boolean | null;
}

function prefsFrom(settings: PrintSettingsRow | null | undefined): PrintPrefs {
  const paper = settings?.receiptPaper;
  const labelSize = settings?.labelSize;
  return {
    labelSize:
      labelSize === "57x32" || labelSize === "62x29" ? labelSize : "40x20",
    paper: paper === "58mm" || paper === "a4" ? paper : "80mm",
    showImei: settings?.receiptShowImei ?? true,
    showProblem: settings?.receiptShowProblem ?? true,
    showQr: settings?.receiptShowQr ?? true,
    showSignature: settings?.receiptShowSignature ?? true,
    showWarranty: settings?.receiptShowWarranty ?? true,
  };
}

const THERMAL_PRESETS: Record<
  "58mm" | "80mm",
  { bodyWidth: string; page: string }
> = {
  "58mm": { bodyWidth: "200px", page: "58mm auto" },
  "80mm": { bodyWidth: "280px", page: "80mm auto" },
};

const LABEL_PRESETS: Record<
  LabelSize,
  { font: string; h: string; qr: string; sub: string; w: string }
> = {
  "40x20": { font: "7pt", h: "20mm", qr: "12mm", sub: "6pt", w: "40mm" },
  "57x32": { font: "8pt", h: "32mm", qr: "16mm", sub: "7pt", w: "57mm" },
  "62x29": { font: "8pt", h: "29mm", qr: "15mm", sub: "7pt", w: "62mm" },
};

const A4_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #111; background: #fff;
    font-size: 11pt; line-height: 1.45;
    padding: 15mm;
  }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 4mm; }
  .doc-head .shop h1 { margin: 0 0 1mm; font-size: 16pt; }
  .doc-head .shop p { margin: 0; font-size: 9pt; color: #444; }
  .doc-head .meta { text-align: right; font-size: 9pt; color: #444; }
  .doc-head .meta .doctype { font-size: 14pt; font-weight: 700; color: #111; letter-spacing: 0.05em; }
  .doc-head .meta .code { font-size: 11pt; font-weight: 700; color: #111; }
  .grid { display: flex; gap: 8mm; margin-top: 5mm; }
  .grid .col { flex: 1; }
  .lbl { font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #666; margin-bottom: 1mm; }
  .problem { margin-top: 5mm; border: 1px solid #ddd; border-radius: 2mm; padding: 3mm; font-size: 10pt; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 5mm; font-size: 10pt; }
  table.items th { text-align: left; border-bottom: 1px solid #111; padding: 1.5mm 2mm; font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase; color: #555; }
  table.items td { padding: 1.5mm 2mm; border-bottom: 1px solid #eee; }
  table.items td.num, table.items th.num { text-align: right; }
  .totals { margin-top: 4mm; margin-left: auto; width: 70mm; font-size: 10pt; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 1mm 0; }
  .totals td.num { text-align: right; }
  .totals tr.grand td { border-top: 2px solid #111; font-weight: 700; font-size: 12pt; padding-top: 2mm; }
  .totals tr.due td { color: #b00; font-weight: 700; }
  .warranty { margin-top: 5mm; font-size: 9pt; }
  .warranty table { width: 100%; border-collapse: collapse; }
  .warranty td { padding: 1mm 0; }
  .warranty td:last-child { text-align: right; color: #444; }
  .sign { margin-top: 8mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; }
  .sign .terms { font-size: 8pt; color: #555; max-width: 90mm; }
  .sign .box { text-align: center; }
  .sign .box img { max-width: 60mm; max-height: 20mm; display: block; }
  .sign .line { border-top: 1px solid #111; width: 60mm; margin-top: 12mm; padding-top: 1mm; font-size: 8pt; color: #555; }
  .foot { margin-top: 8mm; border-top: 1px solid #ddd; padding-top: 3mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; }
  .foot .txt { font-size: 8pt; color: #555; }
  .foot .qr img { width: 22mm; height: 22mm; display: block; }
  .foot .qr p { font-size: 7pt; color: #777; margin: 1mm 0 0; text-align: center; }
  @page { size: A4; margin: 0; }
  @media print { body { padding: 0; } }
  @media screen { body { max-width: 210mm; margin: 0 auto; box-shadow: 0 0 12px #ccc; } }
`;

function a4ShopHeader(
  settings: {
    address?: string | null;
    logoPath?: string | null;
    phone?: string | null;
    shopName?: string | null;
  } | null
): string {
  const shopName = esc(settings?.shopName || "OficinaOS");
  const logoImg = settings?.logoPath
    ? `<img src="${esc(settings.logoPath)}" alt="${shopName}" style="max-height:14mm;max-width:55mm;display:block;margin-bottom:1mm" />`
    : "";
  const addressLine = settings?.address
    ? `<p>${escMultiline(settings.address)}</p>`
    : "";
  const phoneLine = settings?.phone ? `<p>${esc(settings.phone)}</p>` : "";
  return `<div class="shop">${logoImg}<h1>${shopName}</h1>${addressLine}${phoneLine}</div>`;
}

function shopHeaderHtml(
  settings: {
    address?: string | null;
    logoPath?: string | null;
    phone?: string | null;
    shopName?: string | null;
  } | null
): string {
  const shopName = esc(settings?.shopName || "OficinaOS");
  const logoImg = settings?.logoPath
    ? `<div style="text-align:center"><img src="${esc(settings.logoPath)}" alt="${shopName}" style="max-height:14mm;max-width:60mm" /></div>`
    : "";
  const addressLine = settings?.address
    ? `<p>${escMultiline(settings.address)}</p>`
    : "";
  const phoneLine = settings?.phone ? `<p>${esc(settings.phone)}</p>` : "";
  return `${logoImg}<h1>${shopName}</h1>${addressLine}${phoneLine}`;
}

function warrantySectionHtml(
  repairs: Array<{
    repairName: string;
    repair?: { warrantyDays: number | null } | null;
  }>,
  deliveredAt: Date | null,
  defaultWarrantyDays: number,
  s: ReceiptStrings
): string {
  if (repairs.length === 0) {
    return "";
  }
  const rows = repairs
    .map((r) => {
      const days = r.repair?.warrantyDays ?? defaultWarrantyDays;
      const expiry = deliveredAt
        ? ` (${s.warrantyUntil.replace(
            "{date}",
            new Date(
              deliveredAt.getTime() + days * 86_400_000
            ).toLocaleDateString(s.dateLocale)
          )})`
        : "";
      return `<tr><td>${esc(r.repairName)}</td><td style="text-align:right">${s.warrantyDays.replace("{days}", String(days))}${expiry}</td></tr>`;
    })
    .join("");
  return `<div class="sep"></div><p style="text-align:left"><strong>${s.warranty}:</strong></p><table>${rows}</table>`;
}

/**
 * Signature is already a data:image/... URL — the zod create schema enforces
 * the prefix, and we re-check here before embedding it verbatim.
 */
function signatureSectionHtml(
  dataUrl: string | null | undefined,
  termsSigned: string
): string {
  if (!dataUrl?.startsWith("data:image/")) {
    return "";
  }
  return `<p style="text-align:left;font-size:10px;color:#555">${esc(termsSigned)}</p><div style="text-align:center"><img src="${dataUrl}" style="max-width:200px;max-height:60px" alt="signature" /></div><div class="sep"></div>`;
}

export async function renderReceiptHtml(
  prisma: DbClient,
  job: {
    id: string;
    jobCode: string;
    imei?: string | null;
    customer: { name: string; phone: string };
    device: { brand: { name: string }; model: string };
    reportedProblem: string;
    estimatedCost: number | { toNumber: () => number };
    depositAmount?: number | { toNumber: () => number } | null;
    intakeSignatureDataUrl?: string | null;
    createdAt: Date;
    payments?: Array<{
      amount: number | { toNumber: () => number };
      method: string;
    }>;
    partsUsed: Array<{
      partName: string;
      quantity: number;
      totalCost: number | { toNumber: () => number };
    }>;
    repairs: Array<{
      repairName: string;
      price: number | { toNumber: () => number };
      repair?: { warrantyDays: number | null } | null;
    }>;
  },
  baseUrl: string,
  options?: { hideCosts?: boolean; locale?: string }
): Promise<string> {
  const [settings, deliveredLog] = await Promise.all([
    findShopSettingsUnique(prisma),
    prisma.auditLog.findFirst({
      where: {
        action: "STATUS_CHANGED",
        jobId: job.id,
        toValue: "DELIVERED",
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const currency = settings?.currency ?? "EUR";
  const s = receiptStrings(options?.locale);
  const qrBuf = await generateTrackingQr(
    job.jobCode,
    settings?.trackingBaseUrl || baseUrl,
    phone4Of(job.customer.phone)
  );
  const date = new Date(job.createdAt).toLocaleDateString(s.dateLocale);
  const hideCosts = options?.hideCosts ?? false;
  const prefs = prefsFrom(settings);

  const partsUsed = job.partsUsed ?? [];
  const repairs = job.repairs ?? [];
  const payments = job.payments ?? [];

  const partsTotal = partsUsed.reduce((sum, p) => sum + toNum(p.totalCost), 0);
  const repairsTotal = repairs.reduce((sum, r) => sum + toNum(r.price), 0);
  const finalCost = partsTotal + repairsTotal;
  const displayCost = finalCost > 0 ? finalCost : toNum(job.estimatedCost);
  const deposit = job.depositAmount ? toNum(job.depositAmount) : 0;
  const paidTotal =
    payments.reduce((sum, p) => sum + toNum(p.amount), 0) + deposit;
  const balanceDue = Math.max(0, displayCost - paidTotal);
  const hasPayments = paidTotal > 0;

  const methodLabel = (m: string) => esc(s.paymentMethods[m] ?? m);

  const ctx: ReceiptRenderContext = {
    balanceDue,
    currency,
    date,
    deliveredAt: deliveredLog?.createdAt ?? null,
    deposit,
    displayCost,
    hasPayments,
    hideCosts,
    job,
    locale: options?.locale ?? "pt",
    methodLabel,
    partsUsed,
    payments,
    prefs,
    qrBuf,
    repairs,
    s,
    settings,
  };
  return prefs.paper === "a4"
    ? renderA4ReceiptDocument(ctx)
    : renderThermalReceiptDocument(ctx);
}

function costsSectionHtml(args: {
  balanceDue: number;
  currency: string;
  deposit: number;
  displayCost: number;
  hasPayments: boolean;
  hideCosts: boolean;
  methodLabel: (m: string) => string;
  payments: ReceiptRenderContext["payments"];
  s: ReceiptStrings;
}): string {
  if (args.hideCosts) {
    return "";
  }
  const { balanceDue, currency, deposit, displayCost, s } = args;
  let paymentsTable = "";
  if (args.hasPayments) {
    const depositRow =
      deposit > 0
        ? `<tr><td>${s.paidDeposit}</td><td style="text-align:right">${fmtMoney(deposit, currency)}</td></tr>`
        : "";
    const rows = args.payments
      .map(
        (p) =>
          `<tr><td>${s.paid} (${args.methodLabel(p.method)})</td><td style="text-align:right">${fmtMoney(p.amount, currency)}</td></tr>`
      )
      .join("");
    paymentsTable = `<table>${depositRow}${rows}<tr><td><strong>${s.balanceDue}</strong></td><td style="text-align:right"><strong>${fmtMoney(balanceDue, currency)}</strong></td></tr></table>`;
  }
  return `<table><tr><td><strong>${s.total}</strong></td><td style="text-align:right">${fmtMoney(displayCost, currency)}</td></tr></table>${paymentsTable}<div class="sep"></div>`;
}

interface ReceiptRenderContext {
  balanceDue: number;
  currency: string;
  date: string;
  deliveredAt: Date | null;
  deposit: number;
  displayCost: number;
  hasPayments: boolean;
  hideCosts: boolean;
  job: Parameters<typeof renderReceiptHtml>[1];
  locale: string;
  methodLabel: (m: string) => string;
  partsUsed: NonNullable<Parameters<typeof renderReceiptHtml>[1]["partsUsed"]>;
  payments: NonNullable<Parameters<typeof renderReceiptHtml>[1]["payments"]>;
  prefs: PrintPrefs;
  qrBuf: Buffer | null;
  repairs: Parameters<typeof renderReceiptHtml>[1]["repairs"];
  s: ReceiptStrings;
  settings: Awaited<ReturnType<typeof findShopSettingsUnique>>;
}

/**
 * Full-page A4 document — same data as the thermal receipt, laid out as a
 * printable shop document (letterhead, itemised table, signature box).
 */
function renderThermalReceiptDocument(ctx: ReceiptRenderContext): string {
  const { job, prefs, s, settings } = ctx;
  const shopHeader = shopHeaderHtml(settings);
  const warrantyHtml = prefs.showWarranty
    ? warrantySectionHtml(
        ctx.repairs,
        ctx.deliveredAt,
        settings?.defaultWarrantyDays ?? 30,
        s
      )
    : "";
  const signatureHtml = prefs.showSignature
    ? signatureSectionHtml(job.intakeSignatureDataUrl, s.termsSigned)
    : "";
  const qrImg = ctx.qrBuf
    ? `<div class="qr"><img src="data:image/png;base64,${ctx.qrBuf.toString("base64")}" alt="QR Code" /></div>`
    : `<div class="qr" style="color:#999;font-size:10px">${s.qrUnavailable}</div>`;
  const footerHtml = settings?.receiptFooter
    ? `<div class="sep"></div><p style="text-align:left">${escMultiline(settings.receiptFooter)}</p>`
    : "";
  const thermal = THERMAL_PRESETS[prefs.paper === "58mm" ? "58mm" : "80mm"];

  return `<!doctype html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<title>${s.receipt} ${esc(job.jobCode)}</title>
<style>
  @page{size:${thermal.page};margin:0}
  body{font-family:monospace;margin:0 auto;max-width:${thermal.bodyWidth};padding:8px;font-size:12px}
  h1{text-align:center;font-size:16px;margin:0 0 4px}
  p{text-align:center;margin:0 0 8px;color:#555}
  table{width:100%;border-collapse:collapse;margin:4px 0}
  .sep{border-top:1px dashed #000;margin:8px 0}
  .total td{font-weight:bold;border-top:1px solid #000}
  .qr{text-align:center;margin:8px 0}
  .qr img{width:120px}
  @media print{body{margin:0}}
</style>
</head>
<body>
${shopHeader}
<p>${ctx.date}</p>
<div class="sep"></div>
<table><tr><td>${s.job}</td><td style="text-align:right">${esc(job.jobCode)}</td></tr>
<tr><td>${s.customer}</td><td style="text-align:right">${esc(job.customer.name)}</td></tr>
<tr><td>${s.phone}</td><td style="text-align:right">${esc(job.customer.phone)}</td></tr>
<tr><td>${s.device}</td><td style="text-align:right">${esc(job.device.brand.name)} ${esc(job.device.model)}</td></tr>${prefs.showImei && job.imei ? `<tr><td>IMEI</td><td style="text-align:right">${esc(job.imei)}</td></tr>` : ""}</table>
<div class="sep"></div>
${prefs.showProblem ? `<p style="text-align:left"><strong>${s.problem}:</strong> ${esc(job.reportedProblem)}</p><div class="sep"></div>` : ""}
${costsSectionHtml(ctx)}
${warrantyHtml}
${signatureHtml}
${prefs.showQr ? `${qrImg}<p style="text-align:center;font-size:10px;color:#555">${s.scanQr}</p>` : ""}
${footerHtml}
</body></html>`;
}

function renderA4ReceiptDocument(ctx: ReceiptRenderContext): string {
  const { job, prefs, s, settings } = ctx;

  const itemRows = ctx.hideCosts
    ? ""
    : `<table class="items">
<thead><tr><th>${s.items}</th><th class="num">${s.qty}</th><th class="num">${s.total}</th></tr></thead>
<tbody>
${ctx.repairs
  .map(
    (r) =>
      `<tr><td>${esc(r.repairName)}</td><td class="num">1</td><td class="num">${fmtMoney(r.price, ctx.currency)}</td></tr>`
  )
  .join("")}
${ctx.partsUsed
  .map(
    (p) =>
      `<tr><td>${esc(p.partName)}</td><td class="num">${p.quantity}</td><td class="num">${fmtMoney(p.totalCost, ctx.currency)}</td></tr>`
  )
  .join("")}
</tbody></table>`;

  const totalsRows = ctx.hideCosts
    ? ""
    : `<div class="totals"><table>
<tr class="grand"><td>${s.total}</td><td class="num">${fmtMoney(ctx.displayCost, ctx.currency)}</td></tr>
${
  ctx.hasPayments
    ? `${
        ctx.deposit > 0
          ? `<tr><td>${s.paidDeposit}</td><td class="num">${fmtMoney(ctx.deposit, ctx.currency)}</td></tr>`
          : ""
      }${ctx.payments
        .map(
          (p) =>
            `<tr><td>${s.paid} (${ctx.methodLabel(p.method)})</td><td class="num">${fmtMoney(p.amount, ctx.currency)}</td></tr>`
        )
        .join(
          ""
        )}<tr class="due"><td>${s.balanceDue}</td><td class="num">${fmtMoney(ctx.balanceDue, ctx.currency)}</td></tr>`
    : ""
}
</table></div>`;

  const warrantyHtml =
    prefs.showWarranty && ctx.repairs.length > 0
      ? `<div class="warranty"><div class="lbl">${s.warranty}</div><table>${ctx.repairs
          .map((r) => {
            const days =
              r.repair?.warrantyDays ?? settings?.defaultWarrantyDays ?? 30;
            const expiry = ctx.deliveredAt
              ? ` · ${s.warrantyUntil.replace(
                  "{date}",
                  new Date(
                    ctx.deliveredAt.getTime() + days * 86_400_000
                  ).toLocaleDateString(s.dateLocale)
                )}`
              : "";
            return `<tr><td>${esc(r.repairName)}</td><td>${s.warrantyDays.replace("{days}", String(days))}${expiry}</td></tr>`;
          })
          .join("")}</table></div>`
      : "";

  const signatureBox = job.intakeSignatureDataUrl?.startsWith("data:image/")
    ? `<img src="${job.intakeSignatureDataUrl}" alt="signature" />`
    : `<div class="line">${s.signatureLabel}</div>`;
  const signatureHtml = prefs.showSignature
    ? `<div class="sign"><p class="terms">${esc(s.termsSigned)}</p><div class="box">${signatureBox}</div></div>`
    : "";

  const qrHtml =
    prefs.showQr && ctx.qrBuf
      ? `<div class="qr"><img src="data:image/png;base64,${ctx.qrBuf.toString("base64")}" alt="QR" /><p>${s.scanQr}</p></div>`
      : "";

  const footerHtml = settings?.receiptFooter
    ? `<p>${escMultiline(settings.receiptFooter)}</p>`
    : "";
  const footHtml =
    footerHtml || qrHtml
      ? `<div class="foot"><div class="txt">${footerHtml}</div>${qrHtml}</div>`
      : "";

  return `<!doctype html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<title>${s.receipt} ${esc(job.jobCode)}</title>
<style>${A4_CSS}</style>
</head>
<body>
<div class="doc-head">
  ${a4ShopHeader(settings)}
  <div class="meta"><div class="doctype">${s.receipt}</div><div class="code">${esc(job.jobCode)}</div><div>${ctx.date}</div></div>
</div>
<div class="grid">
  <div class="col">
    <div class="lbl">${s.customer}</div>
    <div><strong>${esc(job.customer.name)}</strong></div>
    <div>${s.phone}: ${esc(job.customer.phone)}</div>
  </div>
  <div class="col">
    <div class="lbl">${s.device}</div>
    <div><strong>${esc(job.device.brand.name)} ${esc(job.device.model)}</strong></div>
    ${prefs.showImei && job.imei ? `<div>IMEI: ${esc(job.imei)}</div>` : ""}
  </div>
</div>
${prefs.showProblem ? `<div class="problem"><strong>${s.problem}:</strong> ${esc(job.reportedProblem)}</div>` : ""}
${itemRows}
${totalsRows}
${warrantyHtml}
${signatureHtml}
${footHtml}
</body></html>`;
}

interface SaleReceiptItem {
  lineTotal: number | { toNumber: () => number };
  name: string;
  quantity: number;
}

interface SaleReceiptPayment {
  amount: number | { toNumber: () => number };
  method: string;
  reference?: string | null;
}

/**
 * Thermal-printer friendly POS receipt for counter sales (no repair job).
 */
export async function renderSaleReceiptHtml(
  prisma: DbClient,
  sale: {
    saleCode: string;
    createdAt: Date;
    customer?: { name: string; phone: string } | null;
    createdBy: { name: string };
    items: SaleReceiptItem[];
    payments: SaleReceiptPayment[];
    total: number | { toNumber: () => number };
  },
  _baseUrl: string,
  options?: { locale?: string }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const currency = settings?.currency ?? "EUR";
  const s = receiptStrings(options?.locale);
  const prefs = prefsFrom(settings);

  const date = new Date(sale.createdAt).toLocaleString(s.dateLocale);
  const footerHtml = settings?.receiptFooter
    ? `<div class="sep"></div><p style="text-align:left">${escMultiline(settings.receiptFooter)}</p>`
    : "";

  if (prefs.paper === "a4") {
    const itemRows = sale.items
      .map(
        (i) =>
          `<tr><td>${esc(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${fmtMoney(i.lineTotal, currency)}</td></tr>`
      )
      .join("");
    const payRows = sale.payments
      .map(
        (p) =>
          `<tr><td>${s.paid} (${esc(s.paymentMethods[p.method] ?? p.method)}${p.reference ? ` · ${esc(p.reference)}` : ""})</td><td class="num">${fmtMoney(p.amount, currency)}</td></tr>`
      )
      .join("");
    return `<!doctype html>
<html lang="${options?.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${s.sale} ${esc(sale.saleCode)}</title>
<style>${A4_CSS}</style>
</head>
<body>
<div class="doc-head">
  ${a4ShopHeader(settings)}
  <div class="meta"><div class="doctype">${s.sale}</div><div class="code">${esc(sale.saleCode)}</div><div>${date}</div></div>
</div>
<div class="grid">
  <div class="col">
    <div class="lbl">${s.customer}</div>
    <div><strong>${esc(sale.customer?.name ?? "—")}</strong></div>
  </div>
  <div class="col">
    <div class="lbl">${s.servedBy}</div>
    <div><strong>${esc(sale.createdBy.name)}</strong></div>
  </div>
</div>
<table class="items">
<thead><tr><th>${s.items}</th><th class="num">${s.qty}</th><th class="num">${s.total}</th></tr></thead>
<tbody>${itemRows}</tbody></table>
<div class="totals"><table>
<tr class="grand"><td>${s.total}</td><td class="num">${fmtMoney(sale.total, currency)}</td></tr>
${payRows}
</table></div>
${settings?.receiptFooter ? `<div class="foot"><div class="txt"><p>${escMultiline(settings.receiptFooter)}</p></div></div>` : ""}
</body></html>`;
  }

  const shopHeader = shopHeaderHtml(settings);
  const thermal = THERMAL_PRESETS[prefs.paper];
  const rows = sale.items
    .map(
      (i) =>
        `<tr><td>${esc(i.name)} ×${i.quantity}</td><td style="text-align:right">${fmtMoney(i.lineTotal, currency)}</td></tr>`
    )
    .join("");
  const payRows = sale.payments
    .map(
      (p) =>
        `<tr><td>${s.paid} (${esc(s.paymentMethods[p.method] ?? p.method)}${p.reference ? ` · ${esc(p.reference)}` : ""})</td><td style="text-align:right">${fmtMoney(p.amount, currency)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="${options?.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${s.sale} ${esc(sale.saleCode)}</title>
<style>
  @page{size:${thermal.page};margin:0}
  body{font-family:monospace;margin:0 auto;max-width:${thermal.bodyWidth};padding:8px;font-size:12px}
  h1{text-align:center;font-size:16px;margin:0 0 4px}
  p{text-align:center;margin:0 0 8px;color:#555}
  table{width:100%;border-collapse:collapse;margin:4px 0}
  .sep{border-top:1px dashed #000;margin:8px 0}
  .total td{font-weight:bold;border-top:1px solid #000}
  .qr{text-align:center;margin:8px 0}
  .qr img{width:120px}
  @media print{body{margin:0}}
</style>
</head>
<body>
${shopHeader}
<p>${date}</p>
<div class="sep"></div>
<table><tr><td>${s.sale}</td><td style="text-align:right">${esc(sale.saleCode)}</td></tr>
${sale.customer ? `<tr><td>${s.customer}</td><td style="text-align:right">${esc(sale.customer.name)}</td></tr>` : ""}
<tr><td>${s.servedBy}</td><td style="text-align:right">${esc(sale.createdBy.name)}</td></tr></table>
<div class="sep"></div>
<table>${rows}</table>
<div class="sep"></div>
<table><tr class="total"><td>${s.total}</td><td style="text-align:right">${fmtMoney(sale.total, currency)}</td></tr>${payRows}</table>
${footerHtml}
</body></html>`;
}

interface TradeInReceiptStrings {
  condition: string;
  dateLocale: string;
  declaration: string;
  device: string;
  idDoc: string;
  paidWith: string;
  paymentMethods: Record<string, string>;
  purchasePrice: string;
  seller: string;
  servedBy: string;
  signatureLabel: string;
  title: string;
}

const TRADE_IN_STRINGS: Record<string, TradeInReceiptStrings> = {
  pt: {
    condition: "Estado",
    dateLocale: "pt-PT",
    declaration:
      "Declaro ser o legítimo proprietário do equipamento descrito, que o vendo livre de ónus e encargos, e que os dados de identificação fornecidos são verdadeiros.",
    device: "Equipamento",
    idDoc: "Documento",
    paidWith: "Pago por",
    paymentMethods: {
      CASH: "Numerário",
      STORE_CREDIT: "Saldo em loja",
      TRANSFER: "Transferência",
    },
    purchasePrice: "Valor de compra",
    seller: "Vendedor",
    servedBy: "Atendido por",
    signatureLabel: "Assinatura do vendedor",
    title: "Compra de equipamento usado",
  },
  en: {
    condition: "Condition",
    dateLocale: "en-GB",
    declaration:
      "I declare that I am the lawful owner of the described device, that I sell it free of charges and encumbrances, and that the identification details provided are true.",
    device: "Device",
    idDoc: "ID document",
    paidWith: "Paid by",
    paymentMethods: {
      CASH: "Cash",
      STORE_CREDIT: "Store credit",
      TRANSFER: "Transfer",
    },
    purchasePrice: "Purchase price",
    seller: "Seller",
    servedBy: "Served by",
    signatureLabel: "Seller's signature",
    title: "Used device purchase",
  },
  fr: {
    condition: "État",
    dateLocale: "fr-FR",
    declaration:
      "Je déclare être le propriétaire légitime de l'appareil décrit, le vendre libre de toute charge, et que les informations d'identification fournies sont exactes.",
    device: "Appareil",
    idDoc: "Document d'identité",
    paidWith: "Payé par",
    paymentMethods: {
      CASH: "Espèces",
      STORE_CREDIT: "Avoir magasin",
      TRANSFER: "Virement",
    },
    purchasePrice: "Prix d'achat",
    seller: "Vendeur",
    servedBy: "Servi par",
    signatureLabel: "Signature du vendeur",
    title: "Achat d'appareil d'occasion",
  },
  es: {
    condition: "Estado",
    dateLocale: "es-ES",
    declaration:
      "Declaro ser el propietario legítimo del dispositivo descrito, que lo vendo libre de cargas, y que los datos de identificación facilitados son verdaderos.",
    device: "Dispositivo",
    idDoc: "Documento",
    paidWith: "Pagado por",
    paymentMethods: {
      CASH: "Efectivo",
      STORE_CREDIT: "Saldo en tienda",
      TRANSFER: "Transferencia",
    },
    purchasePrice: "Precio de compra",
    seller: "Vendedor",
    servedBy: "Atendido por",
    signatureLabel: "Firma del vendedor",
    title: "Compra de dispositivo usado",
  },
};

/**
 * Thermal receipt for a trade-in — doubles as the legal proof of the
 * second-hand goods purchase (seller ID + signed declaration).
 */
export async function renderTradeInReceiptHtml(
  prisma: DbClient,
  tradeIn: {
    code: string;
    condition: string;
    createdAt: Date;
    customer: { name: string; phone: string };
    createdBy?: { name: string } | null;
    deviceBrand: string;
    deviceModel: string;
    imei?: string | null;
    notes?: string | null;
    paymentMethod: string;
    purchasePrice: number | { toNumber: () => number };
    sellerIdNumber: string;
    sellerIdType: string;
    signatureDataUrl?: string | null;
    storage?: string | null;
  },
  options?: { locale?: string }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const currency = settings?.currency ?? "EUR";
  const s = TRADE_IN_STRINGS[options?.locale ?? ""] ?? TRADE_IN_STRINGS.pt;
  const shopHeader = shopHeaderHtml(settings);
  const date = new Date(tradeIn.createdAt).toLocaleString(s.dateLocale);
  const signatureImg = tradeIn.signatureDataUrl
    ? `<div style="text-align:center"><img src="${tradeIn.signatureDataUrl}" style="max-width:200px;max-height:60px" alt="signature" /></div>`
    : `<p style="text-align:center">${s.signatureLabel}: ____________________</p>`;
  const footerHtml = settings?.receiptFooter
    ? `<div class="sep"></div><p style="text-align:left">${escMultiline(settings.receiptFooter)}</p>`
    : "";

  return `<!doctype html>
<html lang="${options?.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${s.title} ${esc(tradeIn.code)}</title>
<style>
  body{font-family:monospace;margin:0 auto;max-width:280px;padding:8px;font-size:12px}
  h1{text-align:center;font-size:16px;margin:0 0 4px}
  p{text-align:center;margin:0 0 8px;color:#555}
  table{width:100%;border-collapse:collapse;margin:4px 0}
  .sep{border-top:1px dashed #000;margin:8px 0}
  .total td{font-weight:bold;border-top:1px solid #000}
  @media print{body{margin:0;max-width:none}}
</style>
</head>
<body>
${shopHeader}
<h1>${s.title}</h1>
<p>${date}</p>
<div class="sep"></div>
<table>
<tr><td>${s.seller}</td><td style="text-align:right">${esc(tradeIn.customer.name)}</td></tr>
<tr><td>${s.idDoc}</td><td style="text-align:right">${esc(tradeIn.sellerIdType)} ${esc(tradeIn.sellerIdNumber)}</td></tr>
${tradeIn.createdBy ? `<tr><td>${s.servedBy}</td><td style="text-align:right">${esc(tradeIn.createdBy.name)}</td></tr>` : ""}
</table>
<div class="sep"></div>
<table>
<tr><td>${s.device}</td><td style="text-align:right">${esc(`${tradeIn.deviceBrand} ${tradeIn.deviceModel}`)}</td></tr>
${tradeIn.storage ? `<tr><td>—</td><td style="text-align:right">${esc(tradeIn.storage)}</td></tr>` : ""}
${tradeIn.imei ? `<tr><td>IMEI</td><td style="text-align:right">${esc(tradeIn.imei)}</td></tr>` : ""}
<tr><td>${s.condition}</td><td style="text-align:right">${esc(tradeIn.condition)}</td></tr>
</table>
<div class="sep"></div>
<table>
<tr class="total"><td>${s.purchasePrice}</td><td style="text-align:right">${fmtMoney(tradeIn.purchasePrice, currency)}</td></tr>
<tr><td>${s.paidWith}</td><td style="text-align:right">${esc(s.paymentMethods[tradeIn.paymentMethod] ?? tradeIn.paymentMethod)}</td></tr>
</table>
<div class="sep"></div>
<p style="text-align:left;font-size:10px;color:#555">${esc(s.declaration)}</p>
${signatureImg}
${footerHtml}
</body></html>`;
}

export async function renderLabelHtml(
  prisma: PrismaClient,
  job: {
    jobCode: string;
    customer: { name: string; phone: string };
    device: { brand: { name: string }; model: string };
    reportedProblem: string;
    estimatedCost: number | { toNumber: () => number };
    createdAt: Date;
    partsUsed: Array<{
      partName: string;
      quantity: number;
      totalCost: number | { toNumber: () => number };
    }>;
    repairs: Array<{
      repairName: string;
      price: number | { toNumber: () => number };
    }>;
  },
  baseUrl: string,
  options?: { hideCosts?: boolean; noAutoPrint?: boolean; locale?: string }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const currency = settings?.currency ?? "EUR";
  const s = receiptStrings(options?.locale);
  const prefs = prefsFrom(settings);
  const label = LABEL_PRESETS[prefs.labelSize];
  const shopName = esc(settings?.shopName || "OficinaOS");
  const logoHtml = settings?.logoPath
    ? `<img src="${esc(settings.logoPath)}" alt="${shopName}" style="max-height:4mm;max-width:100%;" />`
    : shopName;

  const qrBuf = await generateTrackingQr(
    job.jobCode,
    settings?.trackingBaseUrl || baseUrl,
    phone4Of(job.customer.phone)
  );
  const qrImg = qrBuf
    ? `<img src="data:image/png;base64,${qrBuf.toString("base64")}" alt="QR" />`
    : `<span style="font-size:5pt;color:#999">${s.qrUnavailable}</span>`;

  const hideCosts = options?.hideCosts ?? false;
  const noAutoPrint = options?.noAutoPrint ?? false;
  const device =
    `${esc(job.device.brand.name)} ${esc(job.device.model)}`.trim();
  const problem = esc(job.reportedProblem);

  const partsTotal = (job.partsUsed ?? []).reduce(
    (sum, p) => sum + toNum(p.totalCost),
    0
  );
  const repairsTotal = (job.repairs ?? []).reduce(
    (sum, r) => sum + toNum(r.price),
    0
  );
  const finalCost = partsTotal + repairsTotal;
  const displayCost = finalCost > 0 ? finalCost : toNum(job.estimatedCost);
  const price = hideCosts ? "" : fmtMoney(displayCost, currency);

  return `<!doctype html>
<html lang="${options?.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${s.label}</title>
<style>
  @page { size: ${label.w} ${label.h}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${label.w}; height: ${label.h};
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: ${label.font}; line-height: 1.3;
    color: #000; background: #fff;
    display: flex; flex-direction: column;
    padding: 0.8mm 1mm;
  }
  .logo-top {
    text-align: center;
    font-weight: 700; font-size: ${label.font};
    padding-bottom: 0.5mm;
    border-bottom: 0.5pt solid #ddd;
    margin-bottom: 0.5mm;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .content {
    display: flex; align-items: stretch;
    flex: 1 1 auto;
  }
  .qr {
    width: ${label.qr};
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .qr img { width: ${label.qr}; height: ${label.qr}; display: block; }
  .info {
    flex: 1 1 auto; min-width: 0;
    padding-left: 1mm;
    display: flex; flex-direction: column; justify-content: center;
  }
  .info .dev { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: ${label.sub}; }
  .info .pb { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: ${label.sub}; color: #333; }
  .info .price { font-weight: 700; font-size: ${label.font}; }
  @media screen { body { border: 1px dashed #999; } }
</style>
</head>
<body${noAutoPrint ? "" : ' onload="window.print(); setTimeout(function(){ window.close(); }, 500);"'}>
  <div class="logo-top">${logoHtml}</div>
  <div class="content">
    <div class="qr">
      ${qrImg}
    </div>
    <div class="info">
      <div class="dev">${device}</div>
      <div class="pb">${problem}</div>
      ${price ? `<div class="price">${price}</div>` : ""}
    </div>
  </div>
</body></html>`;
}

interface OrdersReportLabels {
  allStatuses: string;
  avgOrder: string;
  customer: string;
  dateIn: string;
  dateOut: string;
  device: string;
  margin: string;
  order: string;
  period: string;
  status: string;
  statusLabels: Record<string, string>;
  title: string;
  totalOrders: string;
  totalValue: string;
  value: string;
}

const STATUS_EN: Record<string, string> = {
  INTAKE: "Intake",
  WAITING_FOR_PARTS: "Waiting for parts",
  IN_REPAIR: "In repair",
  ON_HOLD: "On hold",
  DONE: "Done",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

const STATUS_PT: Record<string, string> = {
  INTAKE: "Receção",
  WAITING_FOR_PARTS: "A aguardar peças",
  IN_REPAIR: "Em reparação",
  ON_HOLD: "Em espera",
  DONE: "Concluída",
  DELIVERED: "Entregue",
  RETURNED: "Devolvida",
  CANCELLED: "Cancelada",
};

const STATUS_FR: Record<string, string> = {
  INTAKE: "Réception",
  WAITING_FOR_PARTS: "En attente de pièces",
  IN_REPAIR: "En réparation",
  ON_HOLD: "En pause",
  DONE: "Terminée",
  DELIVERED: "Livrée",
  RETURNED: "Retournée",
  CANCELLED: "Annulée",
};

const STATUS_ES: Record<string, string> = {
  INTAKE: "Recepción",
  WAITING_FOR_PARTS: "Esperando piezas",
  IN_REPAIR: "En reparación",
  ON_HOLD: "En espera",
  DONE: "Terminada",
  DELIVERED: "Entregada",
  RETURNED: "Devuelta",
  CANCELLED: "Cancelada",
};

function ordersReportLabels(locale?: string): OrdersReportLabels {
  if (locale === "es") {
    return {
      title: "Informe de órdenes de reparación",
      period: "Período",
      status: "Estado",
      allStatuses: "Todos los estados",
      totalOrders: "Total de órdenes",
      totalValue: "Valor total",
      avgOrder: "Media por orden",
      margin: "Margen",
      order: "Nº Orden",
      customer: "Cliente",
      device: "Dispositivo",
      value: "Valor",
      dateIn: "Entrada",
      dateOut: "Salida",
      statusLabels: STATUS_ES,
    };
  }
  if (locale === "fr") {
    return {
      title: "Rapport d'ordres de réparation",
      period: "Période",
      status: "État",
      allStatuses: "Tous les états",
      totalOrders: "Total d'ordres",
      totalValue: "Valeur totale",
      avgOrder: "Moyenne par ordre",
      margin: "Marge",
      order: "Nº Ordre",
      customer: "Client",
      device: "Appareil",
      value: "Valeur",
      dateIn: "Entrée",
      dateOut: "Sortie",
      statusLabels: STATUS_FR,
    };
  }
  if (locale === "en") {
    return {
      title: "Repair orders report",
      period: "Period",
      status: "Status",
      allStatuses: "All statuses",
      totalOrders: "Total orders",
      totalValue: "Total value",
      avgOrder: "Average per order",
      margin: "Margin",
      order: "Order Nº",
      customer: "Customer",
      device: "Device",
      value: "Value",
      dateIn: "In",
      dateOut: "Out",
      statusLabels: STATUS_EN,
    };
  }
  return {
    title: "Relatório de ordens de reparação",
    period: "Período",
    status: "Estado",
    allStatuses: "Todos os estados",
    totalOrders: "Total de ordens",
    totalValue: "Valor total",
    avgOrder: "Média por ordem",
    margin: "Margem",
    order: "Nº Ordem",
    customer: "Cliente",
    device: "Equipamento",
    value: "Valor",
    dateIn: "Entrada",
    dateOut: "Saída",
    statusLabels: STATUS_PT,
  };
}

/**
 * A4 print page for the filtered orders report — opens as plain HTML and
 * auto-triggers window.print() so the user can save as PDF.
 */
export async function renderOrdersReportHtml(
  prisma: DbClient,
  report: OrdersReportDTO,
  opts: {
    from: string;
    to: string;
    status?: string;
    includeMargin: boolean;
    locale?: string;
  }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const s = ordersReportLabels(opts.locale);
  const shopName = esc(settings?.shopName || "OficinaOS");
  const statusLabel = opts.status
    ? (s.statusLabels[opts.status] ?? opts.status)
    : s.allStatuses;
  const dateLocale =
    ({ fr: "fr-FR", en: "en-GB", es: "es-ES" } as Record<string, string>)[
      opts.locale ?? "pt"
    ] ?? "pt-PT";
  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString(dateLocale) : "—";

  const rowsHtml = report.rows
    .map(
      (r) => `<tr>
      <td>${esc(r.jobCode)}</td>
      <td>${esc(r.customerName)}</td>
      <td>${esc(r.deviceName)}</td>
      <td>${esc(s.statusLabels[r.status] ?? r.status)}</td>
      <td class="num">${fmtMoney(r.totalValue)}</td>
      ${opts.includeMargin ? `<td class="num">${r.margin === undefined ? "—" : `${r.margin}%`}</td>` : ""}
      <td>${fmtDate(r.createdAt)}</td>
      <td>${fmtDate(r.completedAt)}</td>
    </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="${opts.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${esc(s.title)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:24px;color:#111;font-size:12px}
  h1{font-size:18px;margin:0}
  .meta{color:#555;margin:4px 0 16px;font-size:11px}
  .totals{display:flex;gap:32px;margin-bottom:16px}
  .totals .t b{display:block;font-size:16px}
  .totals .t span{color:#555;font-size:10px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;border-bottom:2px solid #000;padding:4px 6px;font-size:10px;text-transform:uppercase;color:#555}
  td{border-bottom:1px solid #ddd;padding:4px 6px}
  td.num,th.num{text-align:right}
  @media print{body{margin:0}}
  @page{size:A4 landscape;margin:12mm}
</style>
</head>
<body onload="window.print()">
  <h1>${shopName} — ${esc(s.title)}</h1>
  <p class="meta">${esc(s.period)}: ${esc(opts.from)} → ${esc(opts.to)} &nbsp;·&nbsp; ${esc(s.status)}: ${esc(statusLabel)} &nbsp;·&nbsp; ${new Date().toLocaleString(dateLocale)}</p>
  <div class="totals">
    <div class="t"><b>${report.summary.totalOrders}</b><span>${esc(s.totalOrders)}</span></div>
    <div class="t"><b>${fmtMoney(report.summary.totalValue)}</b><span>${esc(s.totalValue)}</span></div>
    <div class="t"><b>${fmtMoney(report.summary.avgOrderValue)}</b><span>${esc(s.avgOrder)}</span></div>
    ${opts.includeMargin && report.summary.avgMargin !== undefined ? `<div class="t"><b>${report.summary.avgMargin}%</b><span>${esc(s.margin)}</span></div>` : ""}
  </div>
  <table>
    <thead><tr>
      <th>${esc(s.order)}</th><th>${esc(s.customer)}</th><th>${esc(s.device)}</th>
      <th>${esc(s.status)}</th><th class="num">${esc(s.value)}</th>
      ${opts.includeMargin ? `<th class="num">${esc(s.margin)} %</th>` : ""}
      <th>${esc(s.dateIn)}</th><th>${esc(s.dateOut)}</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body></html>`;
}
