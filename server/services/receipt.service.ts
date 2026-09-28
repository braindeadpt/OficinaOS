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

function fmtDzd(v: number | { toNumber: () => number }): string {
  const n = typeof v === "number" ? v : v.toNumber();
  return `${n.toLocaleString("en-DZ")} DZD`;
}

const toNum = (v: number | { toNumber: () => number }) =>
  typeof v === "number" ? v : v.toNumber();

export async function renderReceiptHtml(
  prisma: DbClient,
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
  options?: { hideCosts?: boolean }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const shopName = esc(settings?.shopName ?? "OficinaOS");
  const qrBuf = await generateTrackingQr(job.jobCode, baseUrl);
  const qrImg = qrBuf
    ? `<div class="qr"><img src="data:image/png;base64,${qrBuf.toString("base64")}" alt="QR Code" /></div>`
    : `<div class="qr" style="color:#999;font-size:10px">QR unavailable — configure APP_URL</div>`;

  const date = new Date(job.createdAt).toLocaleDateString();
  const hideCosts = options?.hideCosts ?? false;

  const partsUsed = job.partsUsed ?? [];
  const repairs = job.repairs ?? [];

  const partsTotal = partsUsed.reduce((s, p) => s + toNum(p.totalCost), 0);
  const repairsTotal = repairs.reduce((s, r) => s + toNum(r.price), 0);
  const finalCost = partsTotal + repairsTotal;
  const displayCost = finalCost > 0 ? finalCost : toNum(job.estimatedCost);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipt ${esc(job.jobCode)}</title>
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
<h1>${shopName}</h1>
<p>${date}</p>
<div class="sep"></div>
<table><tr><td>Job</td><td style="text-align:right">${esc(job.jobCode)}</td></tr>
<tr><td>Customer</td><td style="text-align:right">${esc(job.customer.name)}</td></tr>
<tr><td>Phone</td><td style="text-align:right">${esc(job.customer.phone)}</td></tr>
<tr><td>Device</td><td style="text-align:right">${esc(job.device.brand.name)} ${esc(job.device.model)}</td></tr></table>
<div class="sep"></div>
<p style="text-align:left"><strong>Problem:</strong> ${esc(job.reportedProblem)}</p>
<div class="sep"></div>
${
  hideCosts
    ? ""
    : `<table><tr><td><strong>Total</strong></td><td style="text-align:right">${fmtDzd(displayCost)}</td></tr></table><div class="sep"></div>`
}
${qrImg}
<p style="text-align:center;font-size:10px;color:#555">Scan QR to track your repair</p>
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
  options?: { hideCosts?: boolean; noAutoPrint?: boolean }
): Promise<string> {
  const settings = await findShopSettingsUnique(prisma);
  const shopName = esc(settings?.shopName || "OficinaOS");
  const logoHtml = settings?.logoPath
    ? `<img src="${esc(settings.logoPath)}" alt="${shopName}" style="max-height:4mm;max-width:100%;" />`
    : shopName;

  const qrBuf = await generateTrackingQr(job.jobCode, baseUrl);
  const qrImg = qrBuf
    ? `<img src="data:image/png;base64,${qrBuf.toString("base64")}" alt="QR" />`
    : `<span style="font-size:5pt;color:#999">QR unavailable</span>`;

  const hideCosts = options?.hideCosts ?? false;
  const noAutoPrint = options?.noAutoPrint ?? false;
  const device =
    `${esc(job.device.brand.name)} ${esc(job.device.model)}`.trim();
  const problem = esc(job.reportedProblem);

  const partsTotal = (job.partsUsed ?? []).reduce(
    (s, p) => s + toNum(p.totalCost),
    0
  );
  const repairsTotal = (job.repairs ?? []).reduce(
    (s, r) => s + toNum(r.price),
    0
  );
  const finalCost = partsTotal + repairsTotal;
  const displayCost = finalCost > 0 ? finalCost : toNum(job.estimatedCost);
  const price = hideCosts ? "" : fmtDzd(displayCost);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Label</title>
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
