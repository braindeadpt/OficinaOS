import type { PrismaClient } from "@generated/client";
import QRCode from "qrcode";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";

export async function generateTrackingQr(
  jobCode: string,
  baseUrl: string
): Promise<Buffer | null> {
  if (!baseUrl) {
    return null;
  }
  return await QRCode.toBuffer(`${baseUrl}/tracking/${jobCode}`, {
    type: "png",
    width: 200,
  });
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

function fmtMoney(
  v: number | { toNumber: () => number },
  currency = "EUR"
): string {
  const n = typeof v === "number" ? v : v.toNumber();
  return `${n.toLocaleString("en-US")} ${currency}`;
}

const toNum = (v: number | { toNumber: () => number }) =>
  typeof v === "number" ? v : v.toNumber();

interface ReceiptStrings {
  balanceDue: string;
  customer: string;
  dateLocale: string;
  device: string;
  job: string;
  label: string;
  paid: string;
  paidDeposit: string;
  paymentMethods: Record<string, string>;
  phone: string;
  problem: string;
  qrUnavailable: string;
  receipt: string;
  sale: string;
  scanQr: string;
  servedBy: string;
  total: string;
}

const RECEIPT_STRINGS: Record<string, ReceiptStrings> = {
  pt: {
    balanceDue: "Por pagar",
    customer: "Cliente",
    dateLocale: "pt-PT",
    device: "Equipamento",
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
    receipt: "Recibo",
    sale: "Venda",
    scanQr: "Leia o código QR para acompanhar a sua reparação",
    servedBy: "Atendido por",
    total: "Total",
  },
  en: {
    balanceDue: "Balance due",
    customer: "Customer",
    dateLocale: "en-GB",
    device: "Device",
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
    receipt: "Receipt",
    sale: "Sale",
    scanQr: "Scan QR to track your repair",
    servedBy: "Served by",
    total: "Total",
  },
  fr: {
    balanceDue: "Reste à payer",
    customer: "Client",
    dateLocale: "fr-FR",
    device: "Appareil",
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
    receipt: "Reçu",
    sale: "Vente",
    scanQr: "Scannez le QR pour suivre votre réparation",
    servedBy: "Servi par",
    total: "Total",
  },
};

function receiptStrings(locale?: string): ReceiptStrings {
  return RECEIPT_STRINGS[locale ?? ""] ?? RECEIPT_STRINGS.pt;
}

function shopHeaderHtml(
  settings: {
    address?: string | null;
    logoPath?: string | null;
    phone?: string | null;
    shopName?: string | null;
  } | null
): string {
  const shopName = esc(settings?.shopName ?? "OficinaOS");
  const logoImg = settings?.logoPath
    ? `<div style="text-align:center"><img src="${esc(settings.logoPath)}" alt="${shopName}" style="max-height:14mm;max-width:60mm" /></div>`
    : "";
  const addressLine = settings?.address
    ? `<p>${escMultiline(settings.address)}</p>`
    : "";
  const phoneLine = settings?.phone ? `<p>${esc(settings.phone)}</p>` : "";
  return `${logoImg}<h1>${shopName}</h1>${addressLine}${phoneLine}`;
}

export async function renderReceiptHtml(
  prisma: DbClient,
  job: {
    jobCode: string;
    imei?: string | null;
    customer: { name: string; phone: string };
    device: { brand: { name: string }; model: string };
    reportedProblem: string;
    estimatedCost: number | { toNumber: () => number };
    depositAmount?: number | { toNumber: () => number } | null;
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
    }>;
  },
  baseUrl: string,
  options?: { hideCosts?: boolean; locale?: string }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const currency = settings?.currency ?? "EUR";
  const s = receiptStrings(options?.locale);
  const shopHeader = shopHeaderHtml(settings);
  const qrBuf = await generateTrackingQr(job.jobCode, baseUrl);
  const qrImg = qrBuf
    ? `<div class="qr"><img src="data:image/png;base64,${qrBuf.toString("base64")}" alt="QR Code" /></div>`
    : `<div class="qr" style="color:#999;font-size:10px">${s.qrUnavailable}</div>`;

  const date = new Date(job.createdAt).toLocaleDateString(s.dateLocale);
  const hideCosts = options?.hideCosts ?? false;

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
  const balanceDue = Math.max(0, finalCost - paidTotal);
  const hasPayments = paidTotal > 0;

  const footerHtml = settings?.receiptFooter
    ? `<div class="sep"></div><p style="text-align:left">${escMultiline(settings.receiptFooter)}</p>`
    : "";

  const methodLabel = (m: string) => esc(s.paymentMethods[m] ?? m);

  return `<!doctype html>
<html lang="${options?.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${s.receipt} ${esc(job.jobCode)}</title>
<style>
  body{font-family:monospace;margin:0 auto;max-width:280px;padding:8px;font-size:12px}
  h1{text-align:center;font-size:16px;margin:0 0 4px}
  p{text-align:center;margin:0 0 8px;color:#555}
  table{width:100%;border-collapse:collapse;margin:4px 0}
  .sep{border-top:1px dashed #000;margin:8px 0}
  .total td{font-weight:bold;border-top:1px solid #000}
  .qr{text-align:center;margin:8px 0}
  .qr img{width:120px}
  @media print{body{margin:0;max-width:none}}
</style>
</head>
<body>
${shopHeader}
<p>${date}</p>
<div class="sep"></div>
<table><tr><td>${s.job}</td><td style="text-align:right">${esc(job.jobCode)}</td></tr>
<tr><td>${s.customer}</td><td style="text-align:right">${esc(job.customer.name)}</td></tr>
<tr><td>${s.phone}</td><td style="text-align:right">${esc(job.customer.phone)}</td></tr>
<tr><td>${s.device}</td><td style="text-align:right">${esc(job.device.brand.name)} ${esc(job.device.model)}</td></tr>${job.imei ? `<tr><td>IMEI</td><td style="text-align:right">${esc(job.imei)}</td></tr>` : ""}</table>
<div class="sep"></div>
<p style="text-align:left"><strong>${s.problem}:</strong> ${esc(job.reportedProblem)}</p>
<div class="sep"></div>
${
  hideCosts
    ? ""
    : `<table><tr><td><strong>${s.total}</strong></td><td style="text-align:right">${fmtMoney(displayCost, currency)}</td></tr></table>${
        hasPayments
          ? `<table>${
              deposit > 0
                ? `<tr><td>${s.paidDeposit}</td><td style="text-align:right">${fmtMoney(deposit, currency)}</td></tr>`
                : ""
            }${payments
              .map(
                (p) =>
                  `<tr><td>${s.paid} (${methodLabel(p.method)})</td><td style="text-align:right">${fmtMoney(p.amount, currency)}</td></tr>`
              )
              .join(
                ""
              )}<tr><td><strong>${s.balanceDue}</strong></td><td style="text-align:right"><strong>${fmtMoney(balanceDue, currency)}</strong></td></tr></table>`
          : ""
      }<div class="sep"></div>`
}
${qrImg}
<p style="text-align:center;font-size:10px;color:#555">${s.scanQr}</p>
${footerHtml}
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
  baseUrl: string,
  options?: { locale?: string }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const currency = settings?.currency ?? "EUR";
  const s = receiptStrings(options?.locale);
  const shopHeader = shopHeaderHtml(settings);
  const qrBuf = await generateTrackingQr(sale.saleCode, baseUrl);
  const qrImg = qrBuf
    ? `<div class="qr"><img src="data:image/png;base64,${qrBuf.toString("base64")}" alt="QR Code" /></div>`
    : "";

  const date = new Date(sale.createdAt).toLocaleString(s.dateLocale);
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
  const footerHtml = settings?.receiptFooter
    ? `<div class="sep"></div><p style="text-align:left">${escMultiline(settings.receiptFooter)}</p>`
    : "";

  return `<!doctype html>
<html lang="${options?.locale ?? "pt"}">
<head>
<meta charset="utf-8">
<title>${s.sale} ${esc(sale.saleCode)}</title>
<style>
  body{font-family:monospace;margin:0 auto;max-width:280px;padding:8px;font-size:12px}
  h1{text-align:center;font-size:16px;margin:0 0 4px}
  p{text-align:center;margin:0 0 8px;color:#555}
  table{width:100%;border-collapse:collapse;margin:4px 0}
  .sep{border-top:1px dashed #000;margin:8px 0}
  .total td{font-weight:bold;border-top:1px solid #000}
  .qr{text-align:center;margin:8px 0}
  .qr img{width:120px}
  @media print{body{margin:0;max-width:none}}
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
${qrImg}
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
  const shopName = esc(settings?.shopName || "OficinaOS");
  const logoHtml = settings?.logoPath
    ? `<img src="${esc(settings.logoPath)}" alt="${shopName}" style="max-height:4mm;max-width:100%;" />`
    : shopName;

  const qrBuf = await generateTrackingQr(job.jobCode, baseUrl);
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
  @page { size: 40mm 20mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 40mm; height: 20mm;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 7pt; line-height: 1.3;
    color: #000; background: #fff;
    display: flex; flex-direction: column;
    padding: 0.8mm 1mm;
  }
  .logo-top {
    text-align: center;
    font-weight: 700; font-size: 7pt;
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
    width: 13mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .qr img { width: 12mm; height: 12mm; display: block; }
  .info {
    flex: 1 1 auto; min-width: 0;
    padding-left: 1mm;
    display: flex; flex-direction: column; justify-content: center;
  }
  .info .dev { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 6pt; }
  .info .pb { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 6pt; color: #333; }
  .info .price { font-weight: 700; font-size: 7.5pt; }
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
