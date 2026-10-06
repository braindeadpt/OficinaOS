import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptSecret: vi.fn(),
}));

vi.mock("../../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
}));

import {
  issueInvoiceForJob,
  issueInvoiceForSale,
} from "../invoicing.service.js";

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as never;

const SETTINGS = {
  cloudEntitlements: ["invoicing"],
  invoicingAccount: "loja-fix",
  invoicingApiKeyEncrypted: "enc-key",
  invoicingEnabled: true,
  invoicingTaxName: "IVA23",
};

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    jobPart: { findMany: vi.fn(async () => []) },
    jobRepair: { findMany: vi.fn(async () => []) },
    sale: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    shopSettings: {
      findUniqueOrThrow: vi.fn(async () => ({ ...SETTINGS })),
    },
    ...overrides,
  } as never;
}

function okDoc(body: object) {
  return {
    json: async () => body,
    ok: true,
    status: 200,
  } as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decryptSecret.mockReturnValue("secret-api-key");
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("issueInvoiceForSale", () => {
  it("requires the invoicing module entitlement", async () => {
    const prisma = fakePrisma({
      sale: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          saleCode: "VND-1",
          invoiceDocId: null,
          customer: null,
          items: [
            {
              name: "Capa",
              quantity: 1,
              unitPrice: 10,
            },
          ],
        })),
        update: vi.fn(),
      },
      shopSettings: {
        findUniqueOrThrow: vi.fn(async () => ({
          ...SETTINGS,
          cloudEntitlements: [],
        })),
      },
    });
    await expect(issueInvoiceForSale(prisma, "s1", log)).rejects.toMatchObject({
      code: "CLOUD_MODULE_REQUIRED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails when invoicing is disabled or misconfigured", async () => {
    for (const patch of [
      { invoicingEnabled: false },
      { invoicingAccount: null },
      { invoicingApiKeyEncrypted: null },
    ]) {
      const prisma = fakePrisma({
        sale: {
          findUnique: vi.fn(async () => ({
            id: "s1",
            saleCode: "VND-1",
            invoiceDocId: null,
            customer: null,
            items: [{ name: "Capa", quantity: 1, unitPrice: 10 }],
          })),
          update: vi.fn(),
        },
        shopSettings: {
          findUniqueOrThrow: vi.fn(async () => ({ ...SETTINGS, ...patch })),
        },
      });
      await expect(
        issueInvoiceForSale(prisma, "s1", log)
      ).rejects.toMatchObject({ code: "INVOICING_NOT_CONFIGURED" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues a simplified invoice for a walk-in sale", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma({
      sale: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          saleCode: "VND-1",
          invoiceDocId: null,
          customer: null,
          items: [
            { name: "Capa", quantity: 2, unitPrice: 12.3 },
            { name: "Película", quantity: 1, unitPrice: 5 },
          ],
        })),
        update,
      },
    });
    fetchSpy
      .mockResolvedValueOnce(okDoc({ simplified_invoice: { id: 42 } }))
      .mockResolvedValueOnce(
        okDoc({
          simplified_invoice: {
            id: 42,
            inverted_sequence_number: "FS 2026/3",
            permalink: "https://ix/fs3",
          },
        })
      );

    const issued = await issueInvoiceForSale(prisma, "s1", log);
    expect(issued).toMatchObject({
      docId: "42",
      docType: "FS",
      number: "FS 2026/3",
      permalink: "https://ix/fs3",
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(
      "https://loja-fix.app.invoicexpress.com/simplified_invoices.json?api_key=secret-api-key"
    );
    const payload = JSON.parse(init.body);
    expect(payload.invoice.client).toMatchObject({
      code: "CF",
      name: "Consumidor final",
    });
    expect(payload.invoice.reference).toBe("VND-1");
    // unit_price is net of IVA23: 12.30 gross → 10.0000 net
    expect(payload.invoice.items).toEqual([
      {
        name: "Capa",
        quantity: 2,
        tax: { name: "IVA23" },
        unit_price: "10.0000",
      },
      {
        name: "Película",
        quantity: 1,
        tax: { name: "IVA23" },
        unit_price: "4.0650",
      },
    ]);

    // Finalize call hits change-state.
    const [url2] = fetchSpy.mock.calls[1] as [string];
    expect(url2).toContain("/simplified_invoices/42/change-state.json");

    expect(update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceDocId: "42",
        invoiceDocType: "FS",
        invoiceNumber: "FS 2026/3",
        invoicePermalink: "https://ix/fs3",
      }),
      where: { id: "s1" },
    });
  });

  it("issues an invoice-receipt when the customer has a NIF", async () => {
    const prisma = fakePrisma({
      sale: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          saleCode: "VND-9",
          invoiceDocId: null,
          customer: {
            id: "c1",
            name: "Empresa SA",
            email: "a@b.pt",
            taxId: "509999999",
          },
          items: [{ name: "Vidro", quantity: 1, unitPrice: 20 }],
        })),
        update: vi.fn(async () => ({})),
      },
    });
    fetchSpy
      .mockResolvedValueOnce(okDoc({ invoice_receipt: { id: 7 } }))
      .mockResolvedValueOnce(okDoc({ invoice_receipt: { id: 7 } }));

    const issued = await issueInvoiceForSale(prisma, "s1", log);
    expect(issued.docType).toBe("FR");

    const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toContain("/invoice_receipts.json");
    const payload = JSON.parse(init.body);
    expect(payload.invoice.client).toMatchObject({
      code: "OFX-c1",
      fiscal_id: "509999999",
      name: "Empresa SA",
    });
  });

  it("rejects when the sale is already invoiced", async () => {
    const prisma = fakePrisma({
      sale: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          saleCode: "VND-1",
          invoiceDocId: "42",
          customer: null,
          items: [{ name: "Capa", quantity: 1, unitPrice: 10 }],
        })),
        update: vi.fn(),
      },
    });
    await expect(issueInvoiceForSale(prisma, "s1", log)).rejects.toMatchObject({
      code: "ALREADY_INVOICED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps provider failures to INVOICING_PROVIDER_FAILED", async () => {
    const prisma = fakePrisma({
      sale: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          saleCode: "VND-1",
          invoiceDocId: null,
          customer: null,
          items: [{ name: "Capa", quantity: 1, unitPrice: 10 }],
        })),
        update: vi.fn(),
      },
    });
    fetchSpy.mockResolvedValueOnce({
      json: async () => ({ errors: { name: ["is invalid"] } }),
      ok: false,
      status: 422,
    } as Response);

    await expect(issueInvoiceForSale(prisma, "s1", log)).rejects.toMatchObject({
      code: "INVOICING_PROVIDER_FAILED",
    });
  });
});

describe("issueInvoiceForJob", () => {
  it("combines repair and part lines into the document", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma({
      job: {
        findUnique: vi.fn(async () => ({
          id: "j1",
          jobCode: "JOB-77",
          invoiceDocId: null,
          customer: { id: "c1", name: "Ana", taxId: null },
        })),
        update,
      },
      jobPart: {
        findMany: vi.fn(async () => [
          { partName: "Ecrã iPhone 12", quantity: 1, unitPrice: 99 },
        ]),
      },
      jobRepair: {
        findMany: vi.fn(async () => [
          { repairName: "Substituição de ecrã", price: 30 },
        ]),
      },
    });
    fetchSpy
      .mockResolvedValueOnce(okDoc({ simplified_invoice: { id: 55 } }))
      .mockResolvedValueOnce(
        okDoc({
          simplified_invoice: { id: 55, inverted_sequence_number: "FS 2026/9" },
        })
      );

    const issued = await issueInvoiceForJob(prisma, "j1", log);
    expect(issued.docId).toBe("55");

    const [, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(init.body);
    expect(payload.invoice.reference).toBe("JOB-77");
    expect(payload.invoice.items).toHaveLength(2);
    expect(payload.invoice.items[0].name).toBe("Substituição de ecrã");
    expect(payload.invoice.items[1].name).toBe("Ecrã iPhone 12");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "j1" } })
    );
  });

  it("rejects when the job is already invoiced", async () => {
    const prisma = fakePrisma({
      job: {
        findUnique: vi.fn(async () => ({
          id: "j1",
          jobCode: "JOB-77",
          invoiceDocId: "55",
          customer: { id: "c1", name: "Ana" },
        })),
        update: vi.fn(),
      },
    });
    await expect(issueInvoiceForJob(prisma, "j1", log)).rejects.toMatchObject({
      code: "ALREADY_INVOICED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects jobs without any billable lines", async () => {
    const prisma = fakePrisma({
      job: {
        findUnique: vi.fn(async () => ({
          id: "j1",
          jobCode: "JOB-77",
          invoiceDocId: null,
          customer: { id: "c1", name: "Ana" },
        })),
        update: vi.fn(),
      },
    });
    await expect(issueInvoiceForJob(prisma, "j1", log)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
