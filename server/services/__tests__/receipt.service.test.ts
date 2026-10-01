import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";

const qrMock = vi.hoisted(() => ({
  toBuffer: vi.fn().mockResolvedValue(Buffer.from("qr")),
}));

vi.mock("qrcode", () => ({ default: qrMock }));

import {
  renderLabelHtml,
  renderReceiptHtml,
  renderSaleReceiptHtml,
} from "../receipt.service.js";

const QR_BASE64_RE = /<img[^>]+src="data:image\/png;base64,[A-Za-z0-9+/=]+"/;

function makePrisma(
  shopName = "OficinaOS Test Shop",
  extra?: {
    auditLogFindFirst?: unknown;
    shopSettings?: Record<string, unknown> | null;
  }
): PrismaClient {
  const settings =
    extra?.shopSettings === undefined
      ? { id: "default", shopName }
      : extra.shopSettings;
  return {
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(extra?.auditLogFindFirst ?? null),
    },
    shopSettings: {
      findUnique: vi.fn().mockResolvedValue(settings),
    },
  } as unknown as PrismaClient;
}

const baseJob = {
  id: "job-1",
  jobCode: "JOB-0042",
  customer: { name: "John Doe", phone: "+351912345678" },
  device: { brand: { name: "iPhone" }, model: "13 Pro" },
  reportedProblem: "Cracked screen",
  estimatedCost: 8500,
  createdAt: new Date("2026-04-21T10:00:00Z"),
  partsUsed: [],
  repairs: [],
};

describe("renderLabelHtml", () => {
  it("includes shop name, device, problem and price", async () => {
    const html = await renderLabelHtml(
      makePrisma("Acme Repairs"),
      baseJob,
      "https://example.com"
    );
    expect(html).toContain("Acme Repairs");
    expect(html).toContain("iPhone");
    expect(html).toContain("13 Pro");
    expect(html).toContain("Cracked screen");
    expect(html).toContain("8,500");
  });

  it("does not show job code in the label body", async () => {
    const html = await renderLabelHtml(makePrisma(), baseJob, "https://x.y");
    expect(html).not.toContain("JOB-0042");
  });

  it("embeds a base64 QR code in left column", async () => {
    const html = await renderLabelHtml(
      makePrisma(),
      baseJob,
      "https://example.com"
    );
    expect(html).toMatch(QR_BASE64_RE);
  });

  it("shows QR unavailable when baseUrl is empty", async () => {
    const html = await renderLabelHtml(makePrisma(), baseJob, "");
    expect(html).toContain("QR indisponível");
    expect(html).not.toMatch(QR_BASE64_RE);
  });

  it("sets @page size to 40mm 20mm and triggers print on load", async () => {
    const html = await renderLabelHtml(makePrisma(), baseJob, "https://x.y");
    expect(html).toContain("size: 40mm 20mm");
    expect(html).toContain("window.print()");
  });

  it("hides price when hideCosts is true", async () => {
    const html = await renderLabelHtml(makePrisma(), baseJob, "https://x.y", {
      hideCosts: true,
    });
    expect(html).not.toContain("8,500");
    expect(html).not.toContain("DZD");
  });

  it("shows finalCost (parts+repairs) over estimatedCost when parts/repairs exist", async () => {
    const jobWithParts = {
      ...baseJob,
      estimatedCost: 0,
      partsUsed: [{ partName: "Screen", quantity: 1, totalCost: 3000 }],
      repairs: [{ repairName: "Replace", price: 2000 }],
    };
    const html = await renderLabelHtml(
      makePrisma(),
      jobWithParts,
      "https://x.y"
    );
    expect(html).toContain("5,000");
  });

  it("escapes HTML in user-supplied fields", async () => {
    const malicious = {
      ...baseJob,
      reportedProblem: "<script>alert(1)</script>",
      device: { brand: { name: 'Acme"' }, model: "<b>X</b>" },
    };
    const html = await renderLabelHtml(makePrisma(), malicious, "https://x.y");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });

  it("falls back to 'OficinaOS' when shopName is empty", async () => {
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const html = await renderLabelHtml(prisma, baseJob, "https://x.y");
    expect(html).toContain("OficinaOS");
  });

  it("renders logo image when logoPath is set", async () => {
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "default",
          shopName: "Acme",
          logoPath: "data:image/png;base64,abc123",
        }),
      },
    } as unknown as PrismaClient;
    const html = await renderLabelHtml(prisma, baseJob, "https://x.y");
    expect(html).toContain('src="data:image/png;base64,abc123"');
    expect(html).not.toContain(">Acme<");
  });

  it("renders shop name text when logoPath is null", async () => {
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "default",
          shopName: "Acme",
          logoPath: null,
        }),
      },
    } as unknown as PrismaClient;
    const html = await renderLabelHtml(prisma, baseJob, "https://x.y");
    expect(html).toContain(">Acme</div>");
  });
});

describe("renderReceiptHtml", () => {
  it("includes shop name, job code, customer info, and device", async () => {
    const html = await renderReceiptHtml(
      makePrisma("Test Shop"),
      baseJob,
      "https://example.com"
    );
    expect(html).toContain("Test Shop");
    expect(html).toContain("JOB-0042");
    expect(html).toContain("John Doe");
    expect(html).toContain("+351912345678");
    expect(html).toContain("iPhone");
    expect(html).toContain("13 Pro");
    expect(html).toContain("Cracked screen");
  });

  it("embeds a base64 QR code", async () => {
    const html = await renderReceiptHtml(
      makePrisma(),
      baseJob,
      "https://example.com"
    );
    expect(html).toMatch(QR_BASE64_RE);
  });

  it("shows QR unavailable when baseUrl is empty", async () => {
    const html = await renderReceiptHtml(makePrisma(), baseJob, "");
    expect(html).toContain("QR indisponível");
    expect(html).not.toMatch(QR_BASE64_RE);
  });

  it("does not include tracking link text", async () => {
    const html = await renderReceiptHtml(makePrisma(), baseJob, "https://x.y");
    expect(html).not.toContain("/tracking/");
    expect(html).toContain("acompanhar");
  });

  it("renders problem and total for parts and repairs", async () => {
    const job = {
      ...baseJob,
      partsUsed: [
        { partName: "Screen", quantity: 1, totalCost: 3000 },
        { partName: "Battery", quantity: 2, totalCost: 4000 },
      ],
      repairs: [{ repairName: "Screen Replace", price: 5000 }],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).toContain("Problema:");
    expect(html).toContain("Cracked screen");
    expect(html).not.toContain("Issue");
    expect(html).not.toContain("Parts Total");
    expect(html).not.toContain("Repairs Total");
    expect(html).toContain("12,000");
  });

  it("renders problem line for repairs", async () => {
    const job = {
      ...baseJob,
      repairs: [{ repairName: "Screen Replace", price: 5000 }],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).toContain("Problema:");
    expect(html).not.toContain("Repairs Total");
  });

  it("hides total cost when hideCosts is true", async () => {
    const job = {
      ...baseJob,
      partsUsed: [{ partName: "Screen", quantity: 1, totalCost: 3000 }],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y", {
      hideCosts: true,
    });
    expect(html).not.toContain("DZD");
    expect(html).not.toContain("Total");
    expect(html).toContain("Problema:");
  });

  it("shows final total line when costs are visible", async () => {
    const job = {
      ...baseJob,
      estimatedCost: 8500,
      partsUsed: [],
      repairs: [],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).toContain("8,500");
    expect(html).toContain("Total");
  });

  it("shows balance due line when payments exist", async () => {
    const job = {
      ...baseJob,
      partsUsed: [{ partName: "Screen", quantity: 1, totalCost: 5000 }],
      repairs: [{ repairName: "Fix", price: 3000 }],
      payments: [{ amount: 3000, method: "CASH" }],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).toContain("Por pagar");
    expect(html).toContain("5,000");
    expect(html).toContain("Pago (Numerário)");
  });

  it("includes deposit as part of the paid total", async () => {
    const job = {
      ...baseJob,
      depositAmount: 1500,
      repairs: [{ repairName: "Fix", price: 3000 }],
      payments: [],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).toContain("Pago (sinal)");
    expect(html).toContain("Por pagar");
    expect(html).toContain("1,500");
  });

  it("shows no payments section when nothing was paid", async () => {
    const job = {
      ...baseJob,
      repairs: [{ repairName: "Fix", price: 3000 }],
      payments: [],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).not.toContain("Por pagar");
    expect(html).toContain("3,000");
  });

  it("escapes payment method labels", async () => {
    const job = {
      ...baseJob,
      payments: [{ amount: 100, method: "<b>X</b>" }],
    };
    const html = await renderReceiptHtml(makePrisma(), job, "https://x.y");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("shows per-repair warranty days with the shop default fallback", async () => {
    const prisma = makePrisma("Shop", {
      shopSettings: { defaultWarrantyDays: 30, id: "default" },
    });
    const job = {
      ...baseJob,
      repairs: [
        {
          price: 5000,
          repair: { warrantyDays: 90 },
          repairName: "Screen replace",
        },
        { price: 1000, repair: null, repairName: "Cleaning" },
      ],
    };
    const html = await renderReceiptHtml(prisma, job, "https://x.y");
    expect(html).toContain("Garantia");
    expect(html).toContain("Screen replace");
    expect(html).toContain("90");
    expect(html).toContain("Cleaning");
    expect(html).toContain("30");
  });

  it("shows warranty expiry dates when the job was delivered", async () => {
    const prisma = makePrisma("Shop", {
      auditLogFindFirst: { createdAt: new Date("2026-01-10T00:00:00Z") },
      shopSettings: { defaultWarrantyDays: 30, id: "default" },
    });
    const job = {
      ...baseJob,
      repairs: [
        {
          price: 5000,
          repair: { warrantyDays: 90 },
          repairName: "Screen replace",
        },
      ],
    };
    const html = await renderReceiptHtml(prisma, job, "https://x.y");
    // 2026-01-10 + 90 days = 2026-04-10
    expect(html).toContain("10/04/2026");
  });

  it("omits the warranty block when the job has no repairs", async () => {
    const html = await renderReceiptHtml(makePrisma(), baseJob, "https://x.y");
    expect(html).not.toContain("Garantia");
  });

  it("prefers ShopSettings.trackingBaseUrl over the APP_URL param for the QR", async () => {
    const prisma = makePrisma("Shop", {
      shopSettings: {
        id: "default",
        trackingBaseUrl: "https://track.example.com",
      },
    });
    await renderReceiptHtml(prisma, baseJob, "https://app-url.example");
    expect(qrMock.toBuffer).toHaveBeenLastCalledWith(
      "https://track.example.com/tracking/JOB-0042?phone4=5678",
      expect.anything()
    );
  });

  it("encodes the customer phone4 in the QR deep link", async () => {
    await renderReceiptHtml(makePrisma(), baseJob, "https://app.example");
    expect(qrMock.toBuffer).toHaveBeenLastCalledWith(
      "https://app.example/tracking/JOB-0042?phone4=5678",
      expect.anything()
    );
  });

  it("omits phone4 from the QR when the customer phone is too short", async () => {
    const job = {
      ...baseJob,
      customer: { name: "John Doe", phone: "12" },
    };
    await renderReceiptHtml(makePrisma(), job, "https://app.example");
    expect(qrMock.toBuffer).toHaveBeenLastCalledWith(
      "https://app.example/tracking/JOB-0042",
      expect.anything()
    );
  });
});

describe("renderSaleReceiptHtml", () => {
  const baseSale = {
    saleCode: "SALE-2026-000001",
    createdAt: new Date("2026-09-28T12:00:00Z"),
    customer: null,
    createdBy: { name: "Diana" },
    items: [
      { name: "iPhone 14 Screen", quantity: 1, lineTotal: 3500 },
      { name: "Tempered glass", quantity: 2, lineTotal: 1000 },
    ],
    payments: [{ amount: 4500, method: "CASH" }],
    total: 4500,
  };

  it("renders sale code, items, total and payment method", async () => {
    const html = await renderSaleReceiptHtml(
      makePrisma("POS Shop"),
      baseSale,
      "https://x.y"
    );
    expect(html).toContain("POS Shop");
    expect(html).toContain("SALE-2026-000001");
    expect(html).toContain("iPhone 14 Screen ×1");
    expect(html).toContain("4,500");
    expect(html).toContain("Pago (Numerário)");
    expect(html).toContain("Atendido por");
  });

  it("shows customer row only when a customer is linked", async () => {
    const withCustomer = {
      ...baseSale,
      customer: { name: "John", phone: "+1555000111" },
    };
    const html = await renderSaleReceiptHtml(
      makePrisma(),
      withCustomer,
      "https://x.y"
    );
    expect(html).toContain("John");
    const plain = await renderSaleReceiptHtml(
      makePrisma(),
      baseSale,
      "https://x.y"
    );
    expect(plain).not.toContain("Cliente");
  });

  it("renders multiple payment lines with references", async () => {
    const multi = {
      ...baseSale,
      payments: [
        { amount: 2000, method: "CASH" },
        { amount: 2500, method: "CARD", reference: "tx-77" },
      ],
    };
    const html = await renderSaleReceiptHtml(
      makePrisma(),
      multi,
      "https://x.y"
    );
    expect(html).toContain("Pago (Numerário)");
    expect(html).toContain("Pago (Cartão · tx-77)");
    expect(html).toContain("2,000");
    expect(html).toContain("2,500");
  });

  it("escapes user-supplied item names and footer", async () => {
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "default",
          shopName: "Shop",
          receiptFooter: "<b>Thanks</b>",
        }),
      },
    } as unknown as PrismaClient;
    const sale = {
      ...baseSale,
      items: [{ name: "<script>x</script>", quantity: 1, lineTotal: 10 }],
    };
    const html = await renderSaleReceiptHtml(prisma, sale, "https://x.y");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;b&gt;Thanks&lt;/b&gt;");
  });

  it("does not render a QR — a sale code resolves no tracking page", async () => {
    const html = await renderSaleReceiptHtml(
      makePrisma(),
      baseSale,
      "https://x.y"
    );
    expect(html).not.toMatch(QR_BASE64_RE);
    expect(html).not.toContain("/tracking/");
  });

  it("includes receipt footer when set", async () => {
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "default",
          shopName: "Shop",
          receiptFooter: "Warranty 30 days",
        }),
      },
    } as unknown as PrismaClient;
    const html = await renderSaleReceiptHtml(prisma, baseSale, "https://x.y");
    expect(html).toContain("Warranty 30 days");
  });
});
