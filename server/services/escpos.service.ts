import { Socket } from "node:net";
import type { ShopSettings } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import iconv from "iconv-lite";
import {
  fmtMoney,
  phone4Of,
  type ReceiptStrings,
  receiptStrings,
  type renderReceiptHtml,
  type renderSaleReceiptHtml,
  toNum,
} from "./receipt.service.js";

type JobReceiptData = Parameters<typeof renderReceiptHtml>[1];
type SaleReceiptData = Parameters<typeof renderSaleReceiptHtml>[1];

// ESC/POS byte commands — Epson-compatible (TM-T20/88, Star, Xprinter, clones)
const ESC = 0x1b;
const GS = 0x1d;
const INIT = Buffer.from([ESC, 0x40]);
const CP850 = Buffer.from([ESC, 0x74, 0x02]);
const CUT = Buffer.from([GS, 0x56, 0x41, 0x03]); // feed 3 rows + partial cut
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
const SIZE_2X_ON = Buffer.from([GS, 0x21, 0x11]);
const SIZE_2X_OFF = Buffer.from([GS, 0x21, 0x00]);

// Characters per line (Font A): 58mm rolls print 32 cols, 80mm prints 42.
const thermalWidth = (paper: string | null | undefined) =>
  paper === "58mm" ? 32 : 42;

const enc = (text: string) => iconv.encode(text, "cp850");

function qrCommand(url: string): Buffer {
  const payload = Buffer.from(url, "ascii");
  const storeLen = payload.length + 3;
  const pL = storeLen % 256;
  const pH = Math.floor(storeLen / 256);
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30]),
    Buffer.from([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    payload,
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

const LINE_BREAK_RE = /\r?\n/;

// Fixed-width text layout for a thermal line printer.
class Ticket {
  readonly segments: Buffer[] = [];
  private readonly width: number;

  constructor(width: number) {
    this.width = width;
  }

  text(raw = ""): void {
    this.segments.push(enc(`${raw}\n`));
  }

  center(raw: string): void {
    const pad = Math.max(0, Math.floor((this.width - raw.length) / 2));
    this.text(" ".repeat(pad) + raw);
  }

  sep(): void {
    this.text("-".repeat(this.width));
  }

  row(left: string, right: string): void {
    const space = this.width - left.length - right.length;
    this.text(
      space > 0 ? left + " ".repeat(space) + right : `${left} ${right}`
    );
  }

  wrap(raw: string): void {
    for (const rawLine of raw.split(LINE_BREAK_RE)) {
      let rest = rawLine;
      while (rest.length > this.width) {
        const cut = rest.slice(0, this.width + 1).lastIndexOf(" ");
        const take = (
          cut > 0 ? rest.slice(0, cut) : rest.slice(0, this.width)
        ).trimEnd();
        this.text(take);
        rest = rest.slice(take.length).trimStart();
      }
      this.text(rest);
    }
  }
}

function trackingUrl(
  jobCode: string,
  baseUrl: string,
  phone?: string
): string | null {
  if (!baseUrl) {
    return null;
  }
  const query = phone ? `?phone4=${encodeURIComponent(phone)}` : "";
  return `${baseUrl}/tracking/${jobCode}${query}`;
}

function shopHeader(t: Ticket, settings: ShopSettings | null): void {
  t.segments.push(ALIGN_CENTER, BOLD_ON, SIZE_2X_ON);
  t.text(settings?.shopName || "OficinaOS");
  t.segments.push(SIZE_2X_OFF, BOLD_OFF);
  if (settings?.address) {
    t.center(settings.address);
  }
  if (settings?.phone) {
    t.center(settings.phone);
  }
  t.segments.push(ALIGN_LEFT);
}

function warrantyLines(
  repairs: JobReceiptData["repairs"],
  deliveredAt: Date | null,
  defaultDays: number,
  s: ReceiptStrings,
  t: Ticket
): void {
  for (const r of repairs) {
    const days = r.repair?.warrantyDays ?? defaultDays;
    let line = `${r.repairName} — ${s.warrantyDays.replace("{days}", String(days))}`;
    if (deliveredAt) {
      const expiry = new Date(deliveredAt);
      expiry.setDate(expiry.getDate() + days);
      line += ` ${s.warrantyUntil.replace("{date}", expiry.toLocaleDateString(s.dateLocale))}`;
    }
    t.wrap(line);
  }
}

function jobCostsSection(
  t: Ticket,
  job: JobReceiptData,
  s: ReceiptStrings,
  currency: string,
  hideCosts: boolean
): void {
  if (hideCosts) {
    return;
  }
  const payments = job.payments ?? [];
  const partsTotal = (job.partsUsed ?? []).reduce(
    (sum, p) => sum + toNum(p.totalCost),
    0
  );
  const repairsTotal = job.repairs.reduce((sum, r) => sum + toNum(r.price), 0);
  const finalCost = partsTotal + repairsTotal;
  const displayCost = finalCost > 0 ? finalCost : toNum(job.estimatedCost);
  const deposit = job.depositAmount ? toNum(job.depositAmount) : 0;
  const paidTotal =
    payments.reduce((sum, p) => sum + toNum(p.amount), 0) + deposit;

  t.sep();
  t.segments.push(BOLD_ON);
  t.row(s.total, fmtMoney(displayCost, currency));
  t.segments.push(BOLD_OFF);
  if (deposit > 0) {
    t.row(s.paidDeposit, fmtMoney(deposit, currency));
  }
  for (const p of payments) {
    const method = s.paymentMethods[p.method] ?? p.method;
    t.row(`${s.paid} (${method})`, fmtMoney(p.amount, currency));
  }
  if (paidTotal > 0) {
    t.segments.push(BOLD_ON);
    t.row(
      s.balanceDue,
      fmtMoney(Math.max(0, displayCost - paidTotal), currency)
    );
    t.segments.push(BOLD_OFF);
  }
}

export function buildJobReceiptEscPos(
  settings: ShopSettings | null,
  job: JobReceiptData,
  baseUrl: string,
  options?: { deliveredAt?: Date | null; hideCosts?: boolean; locale?: string }
): Buffer {
  const s = receiptStrings(options?.locale);
  const currency = settings?.currency ?? "EUR";
  const prefs = {
    showImei: settings?.receiptShowImei ?? true,
    showProblem: settings?.receiptShowProblem ?? true,
    showQr: settings?.receiptShowQr ?? true,
    showSignature: settings?.receiptShowSignature ?? true,
    showWarranty: settings?.receiptShowWarranty ?? true,
  };
  const t = new Ticket(thermalWidth(settings?.receiptPaper));
  t.segments.push(INIT, CP850);

  shopHeader(t, settings);
  t.sep();
  t.center(new Date(job.createdAt).toLocaleDateString(s.dateLocale));
  t.sep();
  t.row(s.job, job.jobCode);
  t.row(s.customer, job.customer.name);
  t.row(s.phone, job.customer.phone);
  t.row(s.device, `${job.device.brand.name} ${job.device.model}`);
  if (prefs.showImei && job.imei) {
    t.row("IMEI", job.imei);
  }
  if (prefs.showProblem) {
    t.sep();
    t.wrap(`${s.problem}: ${job.reportedProblem}`);
  }

  jobCostsSection(t, job, s, currency, options?.hideCosts ?? false);

  if (prefs.showWarranty && job.repairs.length > 0) {
    t.sep();
    t.text(`${s.warranty}:`);
    warrantyLines(
      job.repairs,
      options?.deliveredAt ?? null,
      settings?.defaultWarrantyDays ?? 30,
      s,
      t
    );
  }
  if (prefs.showSignature) {
    t.sep();
    t.wrap(s.termsSigned);
    t.text("\n");
    t.center(s.signatureLabel);
    t.text("______________________________\n");
  }
  const url = trackingUrl(
    job.jobCode,
    settings?.trackingBaseUrl || baseUrl,
    phone4Of(job.customer.phone)
  );
  if (prefs.showQr && url) {
    t.segments.push(ALIGN_CENTER);
    t.text(`\n${s.scanQr}\n`);
    t.segments.push(qrCommand(url));
    t.segments.push(ALIGN_LEFT);
  }
  if (settings?.receiptFooter) {
    t.sep();
    t.wrap(settings.receiptFooter);
  }

  t.segments.push(Buffer.from("\n\n", "ascii"), CUT);
  return Buffer.concat(t.segments);
}

export function buildSaleReceiptEscPos(
  settings: ShopSettings | null,
  sale: SaleReceiptData,
  options?: { locale?: string }
): Buffer {
  const s = receiptStrings(options?.locale);
  const currency = settings?.currency ?? "EUR";
  const t = new Ticket(thermalWidth(settings?.receiptPaper));
  t.segments.push(INIT, CP850);

  shopHeader(t, settings);
  t.sep();
  t.center(new Date(sale.createdAt).toLocaleString(s.dateLocale));
  t.sep();
  t.row(s.sale, sale.saleCode);
  t.row(s.customer, sale.customer?.name ?? "—");
  t.row(s.servedBy, sale.createdBy.name);
  t.sep();
  for (const item of sale.items) {
    const label =
      item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name;
    t.row(label, fmtMoney(item.lineTotal, currency));
  }
  t.sep();
  t.segments.push(BOLD_ON);
  t.row(s.total, fmtMoney(sale.total, currency));
  t.segments.push(BOLD_OFF);
  for (const p of sale.payments) {
    const method = s.paymentMethods[p.method] ?? p.method;
    const ref = p.reference ? ` · ${p.reference}` : "";
    t.row(`${s.paid} (${method}${ref})`, fmtMoney(p.amount, currency));
  }
  if (settings?.receiptFooter) {
    t.sep();
    t.wrap(settings.receiptFooter);
  }

  t.segments.push(Buffer.from("\n\n", "ascii"), CUT);
  return Buffer.concat(t.segments);
}

export function buildTestTicketEscPos(settings: ShopSettings | null): Buffer {
  const t = new Ticket(thermalWidth(settings?.receiptPaper));
  t.segments.push(INIT, CP850);
  shopHeader(t, settings);
  t.sep();
  t.segments.push(ALIGN_CENTER, BOLD_ON);
  t.text("PRINT TEST OK");
  t.segments.push(BOLD_OFF);
  t.text(new Date().toLocaleString("en-GB"));
  t.sep();
  t.segments.push(Buffer.from("\n\n", "ascii"), CUT);
  return Buffer.concat(t.segments);
}

const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,252}$/;
const CONNECT_TIMEOUT_MS = 4000;

export function sendToPrinter(
  host: string,
  port: number,
  data: Buffer,
  timeoutMs = CONNECT_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!HOST_RE.test(host)) {
      reject(new Error(`Invalid printer host: ${host}`));
      return;
    }
    const socket = new Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Printer connection timed out (${host}:${port})`));
    }, timeoutMs);
    const fail = (err: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    socket.connect(port, host, () => {
      socket.end(data, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve();
      });
    });
    socket.on("error", fail);
  });
}

// Direct ESC/POS print — sends to the configured network printer (TCP 9100).
// Browser printing via the HTML endpoints always remains available.
export async function sendEscPos(
  settings: Pick<
    ShopSettings,
    "printerHost" | "printerMode" | "printerPort"
  > | null,
  data: Buffer
): Promise<void> {
  if (settings?.printerMode !== "escpos" || !settings.printerHost) {
    throw new AppError("PRINTER_NOT_CONFIGURED");
  }
  try {
    await sendToPrinter(
      settings.printerHost,
      settings.printerPort ?? 9100,
      data
    );
  } catch {
    throw new AppError("PRINTER_UNREACHABLE");
  }
}
