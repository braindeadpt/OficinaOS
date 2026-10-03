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

function phone4Of(phone: string | null | undefined): string | undefined {
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
    warranty: "Garantia",
    warrantyDays: "{days} dias",
    warrantyUntil: "até {date}",
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
    warranty: "Warranty",
    warrantyDays: "{days} days",
    warrantyUntil: "until {date}",
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
    warranty: "Garantie",
    warrantyDays: "{days} jours",
    warrantyUntil: "jusqu'au {date}",
  },
  es: {
    balanceDue: "Pendiente de pago",
    customer: "Cliente",
    dateLocale: "es-ES",
    device: "Dispositivo",
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
    receipt: "Recibo",
    sale: "Venta",
    scanQr: "Escanea el QR para seguir tu reparación",
    servedBy: "Atendido por",
    total: "Total",
    warranty: "Garantía",
    warrantyDays: "{days} días",
    warrantyUntil: "hasta el {date}",
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
  const shopHeader = shopHeaderHtml(settings);
  const qrBuf = await generateTrackingQr(
    job.jobCode,
    settings?.trackingBaseUrl || baseUrl,
    phone4Of(job.customer.phone)
  );
  const qrImg = qrBuf
    ? `<div class="qr"><img src="data:image/png;base64,${qrBuf.toString("base64")}" alt="QR Code" /></div>`
    : `<div class="qr" style="color:#999;font-size:10px">${s.qrUnavailable}</div>`;

  const date = new Date(job.createdAt).toLocaleDateString(s.dateLocale);
  const hideCosts = options?.hideCosts ?? false;

  const partsUsed = job.partsUsed ?? [];
  const repairs = job.repairs ?? [];
  const payments = job.payments ?? [];

  const warrantyHtml = warrantySectionHtml(
    repairs,
    deliveredLog?.createdAt ?? null,
    settings?.defaultWarrantyDays ?? 30,
    s
  );

  const partsTotal = partsUsed.reduce((sum, p) => sum + toNum(p.totalCost), 0);
  const repairsTotal = repairs.reduce((sum, r) => sum + toNum(r.price), 0);
  const finalCost = partsTotal + repairsTotal;
  const displayCost = finalCost > 0 ? finalCost : toNum(job.estimatedCost);
  const deposit = job.depositAmount ? toNum(job.depositAmount) : 0;
  const paidTotal =
    payments.reduce((sum, p) => sum + toNum(p.amount), 0) + deposit;
  const balanceDue = Math.max(0, displayCost - paidTotal);
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
${warrantyHtml}
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
  _baseUrl: string,
  options?: { locale?: string }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const currency = settings?.currency ?? "EUR";
  const s = receiptStrings(options?.locale);
  const shopHeader = shopHeaderHtml(settings);

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

function ordersReportLabels(locale?: string): OrdersReportLabels {
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
    ({ fr: "fr-FR", en: "en-GB" } as Record<string, string>)[
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
