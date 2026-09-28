import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import { renderLabelHtml, renderReceiptHtml } from "../receipt.service.js";

const QR_BASE64_RE = /<img[^>]+src="data:image\/png;base64,[A-Za-z0-9+/=]+"/;

function makePrisma(shopName = "OficinaOS Test Shop"): PrismaClient {
  return {
    shopSettings: {
      findUnique: vi.fn().mockResolvedValue({ id: "default", shopName }),
    },
  } as unknown as PrismaClient;
}

const baseJob = {
  jobCode: "JOB-0042",
  customer: { name: "John Doe", phone: "+213555000000" },
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
    expect(html).toContain("QR unavailable");
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
    expect(html).toContain("+213555000000");
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
    expect(html).toContain("QR unavailable");
    expect(html).not.toMatch(QR_BASE64_RE);
  });

  it("does not include tracking link text", async () => {
    const html = await renderReceiptHtml(makePrisma(), baseJob, "https://x.y");
    expect(html).not.toContain("/tracking/");
    expect(html).toContain("Scan QR");
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
    expect(html).toContain("Problem:");
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
    expect(html).toContain("Problem:");
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
    expect(html).toContain("Problem:");
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
});
