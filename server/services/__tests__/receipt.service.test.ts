import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import { renderLabelHtml, renderReceiptHtml } from "../receipt.service";

function mockPrisma(settings: Record<string, unknown> | null) {
  return {
    auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
    shopSettings: {
      findUnique: vi.fn().mockResolvedValue(settings),
    },
  } as unknown as PrismaClient;
}

const BASE_JOB = {
  createdAt: new Date("2026-01-15T10:00:00Z"),
  customer: { name: "Maria Silva", phone: "912345678" },
  depositAmount: null,
  device: { brand: { name: "Apple" }, model: "iPhone 13" },
  estimatedCost: 120,
  id: "job1",
  imei: "356789104567890",
  intakeSignatureDataUrl: "data:image/png;base64,AAAA",
  jobCode: "R-2026-0001",
  partsUsed: [{ partName: "Screen", quantity: 1, totalCost: 50 }],
  payments: [],
  reportedProblem: "Broken screen",
  repairs: [
    {
      price: 70,
      repair: { warrantyDays: 90 },
      repairName: "Screen replacement",
    },
  ],
};

const FULL_SETTINGS = {
  currency: "EUR",
  defaultWarrantyDays: 30,
  labelSize: "40x20",
  receiptPaper: "80mm",
  receiptShowImei: true,
  receiptShowProblem: true,
  receiptShowQr: true,
  receiptShowSignature: true,
  receiptShowWarranty: true,
  shopName: "Oficina XPTO",
};

describe("renderReceiptHtml paper presets", () => {
  it("defaults to 80mm thermal when no settings exist", async () => {
    const html = await renderReceiptHtml(mockPrisma(null), BASE_JOB, "", {});
    expect(html).toContain("80mm auto");
  });

  it("renders 58mm layout when receiptPaper is 58mm", async () => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, receiptPaper: "58mm" });
    const html = await renderReceiptHtml(prisma, BASE_JOB, "", {});
    expect(html).toContain("58mm auto");
    expect(html).not.toContain("size: A4");
  });

  it("renders the A4 document when receiptPaper is a4", async () => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, receiptPaper: "a4" });
    const html = await renderReceiptHtml(prisma, BASE_JOB, "", {});
    expect(html).toContain("size: A4");
    expect(html).not.toContain("font-family:monospace");
  });
});

describe("renderReceiptHtml section toggles", () => {
  const withToggle = async (patch: Record<string, unknown>) => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, ...patch });
    return await renderReceiptHtml(prisma, BASE_JOB, "", {});
  };

  it("hides the IMEI row when receiptShowImei is off", async () => {
    const html = await withToggle({ receiptShowImei: false });
    expect(html).not.toContain("356789104567890");
  });

  it("hides the reported problem when receiptShowProblem is off", async () => {
    const html = await withToggle({ receiptShowProblem: false });
    expect(html).not.toContain("Broken screen");
  });

  it("hides the signature when receiptShowSignature is off", async () => {
    const html = await withToggle({ receiptShowSignature: false });
    expect(html).not.toContain("data:image/png;base64,AAAA");
  });

  it("hides the QR block when receiptShowQr is off", async () => {
    const html = await withToggle({ receiptShowQr: false });
    expect(html).not.toContain('class="qr"');
  });

  it("hides the warranty table when receiptShowWarranty is off", async () => {
    const html = await withToggle({ receiptShowWarranty: false });
    expect(html).not.toContain("Garantia:");
  });

  it("shows every section by default", async () => {
    const html = await withToggle({});
    expect(html).toContain("356789104567890");
    expect(html).toContain("Broken screen");
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain('class="qr"');
    expect(html).toContain("Garantia:");
  });
});

describe("renderReceiptHtml loaner device", () => {
  const render = async (jobPatch: Record<string, unknown>, paper = "80mm") => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, receiptPaper: paper });
    return await renderReceiptHtml(
      prisma,
      { ...BASE_JOB, ...jobPatch },
      "",
      {}
    );
  };

  it("shows the loaner note on the thermal receipt", async () => {
    const html = await render({
      hasLoanerDevice: true,
      loanerNote: "Nokia 105",
    });
    expect(html).toContain("Equip. empréstimo");
    expect(html).toContain("Nokia 105");
  });

  it("falls back to a generic label when there is no note", async () => {
    const html = await render({ hasLoanerDevice: true, loanerNote: null });
    expect(html).toContain("Equip. empréstimo");
    expect(html).toContain("Sim");
  });

  it("shows the loaner on the A4 receipt", async () => {
    const html = await render(
      { hasLoanerDevice: true, loanerNote: "Moto G" },
      "a4"
    );
    expect(html).toContain("Equip. empréstimo");
    expect(html).toContain("Moto G");
  });

  it("omits the loaner row when no device was loaned", async () => {
    const html = await render({ hasLoanerDevice: false });
    expect(html).not.toContain("empréstimo");
  });
});

describe("renderLabelHtml label sizes", () => {
  it("defaults to the 40x20 sheet", async () => {
    const html = await renderLabelHtml(mockPrisma(null), BASE_JOB, "", {});
    expect(html).toContain("size: 40mm 20mm");
  });

  it("renders the 57x32 sheet", async () => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, labelSize: "57x32" });
    const html = await renderLabelHtml(prisma, BASE_JOB, "", {});
    expect(html).toContain("size: 57mm 32mm");
  });

  it("renders the 62x29 sheet", async () => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, labelSize: "62x29" });
    const html = await renderLabelHtml(prisma, BASE_JOB, "", {});
    expect(html).toContain("size: 62mm 29mm");
  });
});
