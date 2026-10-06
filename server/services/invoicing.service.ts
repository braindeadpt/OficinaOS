import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";

/**
 * Faturação (módulo Pro "invoicing") — emissão de documentos fiscais via
 * InvoiceXpress. A conta e a API key pertencem à loja e ficam locais
 * (encriptadas como a AI key); a app chama a API diretamente — a cloud do
 * OficinaOS só controla o entitlement.
 *
 * Regra de documento: cliente com NIF → fatura-recibo (invoice_receipts);
 * sem NIF → fatura simplificada (simplified_invoices, "Consumidor final").
 * Preços da loja são finais (IVA incluído) — a API espera unit_price sem
 * IVA, por isso cada linha envia o valor líquido calculado da taxa.
 */

const MODULE = "invoicing";
const TAX_RATE_RE = /IVA(\d+)/i;
const ACCOUNT_RE = /^[a-z0-9-]+$/i;

export interface IssuedInvoice {
  docId: string;
  docType: "FS" | "FR";
  number: string | null;
  permalink: string | null;
}

interface InvoiceLine {
  name: string;
  quantity: number;
  unitPriceGrossCents: number;
}

interface InvoiceCustomer {
  email?: string | null;
  id?: string;
  name: string;
  taxId?: string | null;
}

interface SettingsLike {
  cloudEntitlements: unknown;
  invoicingAccount: string | null;
  invoicingApiKeyEncrypted: string | null;
  invoicingEnabled: boolean;
  invoicingTaxName: string;
}

interface IxDocument {
  id?: number;
  inverted_sequence_number?: string | null;
  permalink?: string | null;
}

async function loadInvoicingConfig(prisma: PrismaClient): Promise<{
  account: string;
  apiKey: string;
  taxName: string;
}> {
  const settings = (await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  })) as unknown as SettingsLike;
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[])
    : [];
  if (!modules.includes(MODULE)) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  if (!settings.invoicingEnabled) {
    throw new AppError("INVOICING_NOT_CONFIGURED");
  }
  const account = settings.invoicingAccount?.trim() ?? "";
  const apiKey = settings.invoicingApiKeyEncrypted
    ? decryptSecret(settings.invoicingApiKeyEncrypted)
    : "";
  if (!(ACCOUNT_RE.test(account) && apiKey)) {
    throw new AppError("INVOICING_NOT_CONFIGURED");
  }
  return { account, apiKey, taxName: settings.invoicingTaxName || "IVA23" };
}

/** "IVA23" → 0.23. Unknown names default to the standard continental rate. */
function taxRate(taxName: string): number {
  const m = TAX_RATE_RE.exec(taxName);
  return m ? Number.parseInt(m[1], 10) / 100 : 0.23;
}

function toDateString(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * The API wraps responses in a key named after the singular document type
 * ("invoice_receipt", "simplified_invoice", "invoice") — not a generic
 * "invoice". `path` is like "/invoice_receipts.json" or
 * "/invoice_receipts/123/change-state.json".
 */
const TRAILING_S = /s$/;
const JSON_EXT = /\.json$/;

function docKey(path: string): string {
  const collection = path.split("/")[1]?.replace(JSON_EXT, "") ?? "";
  return collection.replace(TRAILING_S, "");
}

async function ixFetch(
  account: string,
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<IxDocument> {
  const res = await fetch(
    `https://${account}.app.invoicexpress.com${path}?api_key=${encodeURIComponent(apiKey)}`,
    {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: { "content-type": "application/json" },
      method: init.method ?? "GET",
    }
  ).catch(() => null);
  if (!res) {
    throw new AppError("INVOICING_PROVIDER_FAILED");
  }
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!res.ok) {
    throw new AppError("INVOICING_PROVIDER_FAILED", {
      providerStatus: res.status,
      upstream: body?.errors,
    });
  }
  return ((body?.[docKey(path)] ?? body?.invoice ?? body) as IxDocument) ?? {};
}

/**
 * Emite o documento: cria rascunho → finaliza (fica pago para FR). Devolve
 * refs para persistir no Sale/Job — a persistência é do caller.
 */
async function issueDocument(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  input: {
    customer: InvoiceCustomer | null;
    lines: InvoiceLine[];
    reference: string;
  }
): Promise<IssuedInvoice> {
  const { account, apiKey, taxName } = await loadInvoicingConfig(prisma);
  const rate = taxRate(taxName);
  const hasTaxId = Boolean(input.customer?.taxId?.trim());
  const docPath = hasTaxId ? "invoice_receipts" : "simplified_invoices";
  const date = toDateString(new Date());

  const created = await ixFetch(account, apiKey, `/${docPath}.json`, {
    body: {
      invoice: {
        client: input.customer
          ? {
              code: input.customer.id ? `OFX-${input.customer.id}` : "CF",
              email: input.customer.email || undefined,
              fiscal_id: input.customer.taxId?.trim() || undefined,
              name: input.customer.name,
            }
          : { code: "CF", name: "Consumidor final" },
        date,
        due_date: date,
        items: input.lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          tax: { name: taxName },
          unit_price: (
            Math.round((l.unitPriceGrossCents / 100 / (1 + rate)) * 10_000) /
            10_000
          ).toFixed(4),
        })),
        reference: input.reference,
      },
    },
    method: "POST",
  });

  const docId = created.id;
  if (!docId) {
    log.warn({ created }, "InvoiceXpress create returned no document id");
    throw new AppError("INVOICING_PROVIDER_FAILED");
  }

  const finalized = await ixFetch(
    account,
    apiKey,
    `/${docPath}/${docId}/change-state.json`,
    {
      body: { invoice: { state: "finalized" } },
      method: "PUT",
    }
  );

  return {
    docId: String(docId),
    docType: hasTaxId ? "FR" : "FS",
    number: finalized.inverted_sequence_number ?? null,
    permalink: finalized.permalink ?? created.permalink ?? null,
  };
}

export async function issueInvoiceForSale(
  prisma: PrismaClient,
  saleId: string,
  log: FastifyBaseLogger
): Promise<IssuedInvoice> {
  const sale = await prisma.sale.findUnique({
    include: { customer: true, items: true },
    where: { id: saleId },
  });
  if (!sale) {
    throw new AppError("SALE_NOT_FOUND");
  }
  if (sale.invoiceDocId) {
    throw new AppError("ALREADY_INVOICED");
  }
  if (sale.items.length === 0) {
    throw new AppError("VALIDATION_ERROR");
  }

  const issued = await issueDocument(prisma, log, {
    customer: sale.customer,
    lines: sale.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPriceGrossCents: Math.round(Number(i.unitPrice) * 100),
    })),
    reference: sale.saleCode,
  });

  await prisma.sale.update({
    data: {
      invoiceDocId: issued.docId,
      invoiceDocType: issued.docType,
      invoiceNumber: issued.number,
      invoicePermalink: issued.permalink,
      invoicedAt: new Date(),
    },
    where: { id: sale.id },
  });
  return issued;
}

export async function issueInvoiceForJob(
  prisma: PrismaClient,
  jobId: string,
  log: FastifyBaseLogger
): Promise<IssuedInvoice> {
  const job = await prisma.job.findUnique({
    include: { customer: true },
    where: { id: jobId },
  });
  if (!job) {
    throw new AppError("JOB_NOT_FOUND");
  }
  if (job.invoiceDocId) {
    throw new AppError("ALREADY_INVOICED");
  }

  const [repairs, parts] = await Promise.all([
    prisma.jobRepair.findMany({
      select: { price: true, repairName: true },
      where: { jobId },
    }),
    prisma.jobPart.findMany({
      select: { partName: true, quantity: true, unitPrice: true },
      where: { jobId },
    }),
  ]);
  const lines: InvoiceLine[] = [
    ...repairs.map((r) => ({
      name: r.repairName,
      quantity: 1,
      unitPriceGrossCents: Math.round(Number(r.price) * 100),
    })),
    ...parts.map((p) => ({
      name: p.partName,
      quantity: p.quantity,
      unitPriceGrossCents: Math.round(Number(p.unitPrice) * 100),
    })),
  ];
  if (lines.length === 0) {
    throw new AppError("VALIDATION_ERROR");
  }

  const issued = await issueDocument(prisma, log, {
    customer: job.customer,
    lines,
    reference: job.jobCode,
  });

  await prisma.job.update({
    data: {
      invoiceDocId: issued.docId,
      invoiceDocType: issued.docType,
      invoiceNumber: issued.number,
      invoicePermalink: issued.permalink,
      invoicedAt: new Date(),
    },
    where: { id: job.id },
  });
  return issued;
}
