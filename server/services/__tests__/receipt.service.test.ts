import type { PrismaClient } from "@generated/client";
import { buildLoanerAgreementDocument } from "@shared/loaner-agreement-document.js";
import { describe, expect, it, vi } from "vitest";
import {
  receiptStrings,
  renderLabelHtml,
  renderLoanerAgreementHtml,
  renderReceiptHtml,
  termsProvenanceLine,
} from "../receipt.service";

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

describe("renderReceiptHtml signed clauses", () => {
  const A4 = { ...FULL_SETTINGS, receiptPaper: "a4" };

  it("A4 prints the clauses frozen in the signed snapshot", async () => {
    const prisma = mockPrisma({
      ...A4,
      intakeTerms: "TERMOS ACTUAIS QUE NAO FORAM ASSINADOS",
    });
    const job = {
      ...BASE_JOB,
      intakeTermsSnapshot: {
        termsText: "Cláusulas <b>da loja</b>\nSegunda linha",
      },
    };
    const html = await renderReceiptHtml(prisma, job, "", {});
    expect(html).toContain("Cláusulas");
    expect(html).toContain("Segunda linha");
    expect(html).not.toContain("<b>da loja</b>");
    expect(html).not.toContain("TERMOS ACTUAIS");
  });

  it("A4 does not present current clauses as signed for legacy jobs", async () => {
    const prisma = mockPrisma({ ...A4, intakeTerms: "Termos atuais da loja" });
    const html = await renderReceiptHtml(prisma, BASE_JOB, "", {});
    expect(html).not.toContain("Termos atuais da loja");
    expect(html).toContain("aceito os termos de reparação");
  });

  it("A4 shows the shop clauses on unsigned jobs", async () => {
    const prisma = mockPrisma({ ...A4, intakeTerms: "Termos atuais da loja" });
    const job = { ...BASE_JOB, intakeSignatureDataUrl: null };
    const html = await renderReceiptHtml(prisma, job, "", {});
    expect(html).toContain("Termos atuais da loja");
  });

  it("marks signed legacy jobs without a hash as anterior à data", async () => {
    const prisma = mockPrisma({ ...A4, intakeTerms: "Termos atuais da loja" });
    const job = {
      ...BASE_JOB,
      signedAt: new Date("2026-01-15T10:00:00Z"),
    };
    const html = await renderReceiptHtml(prisma, job, "", {});
    expect(html).toContain("Assinatura anterior a 15/01/2026");
    expect(html).not.toContain("Documento assinado #");
  });

  it("thermal also prints the clauses frozen in the signed snapshot", async () => {
    const prisma = mockPrisma({
      ...FULL_SETTINGS,
      intakeTerms: "TERMOS ACTUAIS QUE NAO FORAM ASSINADOS",
    });
    const job = {
      ...BASE_JOB,
      intakeTermsSnapshot: { termsText: "Cláusulas da loja" },
    };
    const html = await renderReceiptHtml(prisma, job, "", {});
    expect(html).toContain("Cláusulas da loja");
    expect(html).not.toContain("TERMOS ACTUAIS");
  });
});

describe("renderReceiptHtml high contrast", () => {
  it("bolds every line and blacks out grays when printerHighContrast is on", async () => {
    const prisma = mockPrisma({ ...FULL_SETTINGS, printerHighContrast: true });
    const html = await renderReceiptHtml(prisma, BASE_JOB, "", {});
    expect(html).toContain(
      "body *{color:#000 !important;font-weight:700 !important}"
    );
  });

  it("omits the override when printerHighContrast is off", async () => {
    const prisma = mockPrisma(FULL_SETTINGS);
    const html = await renderReceiptHtml(prisma, BASE_JOB, "", {});
    expect(html).not.toContain("font-weight:700 !important");
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

const DOC_REF_RE = /Documento #([0-9a-f]{12})/;

describe("renderLoanerAgreementHtml signature integrity", () => {
  // The job row carries an intake signature + hash — they seal the ficha, a
  // different document. The agreement must never present them as covering
  // its own liability clauses.
  const AGREEMENT_JOB = {
    createdAt: new Date("2026-01-15T10:00:00Z"),
    customer: { name: "Maria Silva", phone: "912345678", taxId: "123456789" },
    device: { brand: { name: "Apple" }, model: "iPhone 13" },
    intakeDocumentHash: "abc123intakehashdef456",
    intakeSignatureDataUrl: "data:image/png;base64,AAAA",
    jobCode: "R-2026-0001",
    loanerDevice: {
      brand: "Nokia",
      imei: "999888",
      label: "Loja #1",
      model: "105",
    },
    loanerNote: "Loja #1 (Nokia 105) · IMEI 999888",
    loanerReturnedAt: null,
    signedAt: new Date("2026-01-15T10:05:00Z"),
  };

  it("never renders the intake signature or its hash seal", async () => {
    const html = await renderLoanerAgreementHtml(
      mockPrisma(FULL_SETTINGS),
      AGREEMENT_JOB
    );
    expect(html).not.toContain("data:image/png;base64,AAAA");
    expect(html).not.toContain("abc123intakehashdef456");
    expect(html).toContain("Assinatura do cliente");
  });

  it("prints an integrity reference bound to the printed content", async () => {
    const ref = (html: string) => DOC_REF_RE.exec(html)?.[1] ?? null;
    const a = await renderLoanerAgreementHtml(
      mockPrisma(FULL_SETTINGS),
      AGREEMENT_JOB
    );
    const b = await renderLoanerAgreementHtml(mockPrisma(FULL_SETTINGS), {
      ...AGREEMENT_JOB,
      loanerDevice: {
        brand: "Nokia",
        imei: "999888",
        label: "Loja #2",
        model: "105",
      },
    });
    expect(ref(a)).toBeTruthy();
    expect(ref(a)).not.toBe(ref(b));
  });

  it("renders the digital signature + seal when the snapshot still matches", async () => {
    const html = await renderLoanerAgreementHtml(mockPrisma(FULL_SETTINGS), {
      ...AGREEMENT_JOB,
      loanerAgreementSignatureDataUrl: "data:image/png;base64,BBBB",
      loanerAgreementSnapshot: buildLoanerAgreementDocument(
        AGREEMENT_JOB,
        "pt"
      ),
      loanerAgreementDocumentHash: "aa11bb22cc33dd44",
      loanerAgreementSignedAt: new Date("2026-01-15T10:06:00Z"),
    });
    expect(html).toContain("data:image/png;base64,BBBB");
    expect(html).toContain("Documento assinado #aa11bb22cc33");
    expect(html).not.toMatch(DOC_REF_RE);
  });

  it("reprints a signed agreement in the frozen language, not the browser's", async () => {
    // Signed in PT; the print request comes in with EN (browser
    // Accept-Language). The document is frozen in pt — the reprint uses
    // that language so the stored signature and seal still apply.
    const html = await renderLoanerAgreementHtml(
      mockPrisma(FULL_SETTINGS),
      {
        ...AGREEMENT_JOB,
        loanerAgreementSignatureDataUrl: "data:image/png;base64,BBBB",
        loanerAgreementSnapshot: buildLoanerAgreementDocument(
          AGREEMENT_JOB,
          "pt"
        ),
        loanerAgreementDocumentHash: "aa11bb22cc33dd44",
        loanerAgreementSignedAt: new Date("2026-01-15T10:06:00Z"),
      },
      { locale: "en" }
    );
    expect(html).toContain("data:image/png;base64,BBBB");
    expect(html).toContain('lang="pt"');
    expect(html).toContain("Documento assinado #");
  });

  it("falls back to the paper line when the signed snapshot went stale", async () => {
    // The fleet unit was swapped after signing — the signature no longer
    // covers the printed unit, so the agreement must not present it.
    const html = await renderLoanerAgreementHtml(mockPrisma(FULL_SETTINGS), {
      ...AGREEMENT_JOB,
      loanerDevice: {
        brand: "Nokia",
        imei: "999888",
        label: "Loja #9",
        model: "105",
      },
      loanerAgreementSignatureDataUrl: "data:image/png;base64,BBBB",
      loanerAgreementSnapshot: buildLoanerAgreementDocument(
        AGREEMENT_JOB,
        "pt"
      ),
      loanerAgreementDocumentHash: "aa11bb22cc33dd44",
      loanerAgreementSignedAt: new Date("2026-01-15T10:06:00Z"),
    });
    expect(html).not.toContain("data:image/png;base64,BBBB");
    expect(html).not.toContain("Documento assinado");
    expect(html).toContain("Assinatura do cliente");
    expect(html).toMatch(DOC_REF_RE);
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

describe("renderLabelHtml identification", () => {
  it("prints the job code as readable text for scanner-free lookup", async () => {
    const html = await renderLabelHtml(mockPrisma(null), BASE_JOB, "", {});
    expect(html).toContain('<div class="code">R-2026-0001</div>');
  });

  it("auto-prints via external script — the route CSP blocks inline handlers", async () => {
    const html = await renderLabelHtml(mockPrisma(null), BASE_JOB, "", {});
    expect(html).toContain('<script src="/label-print.js"></script>');
    expect(html).not.toContain("onload=");
  });

  it("omits the print script in preview mode", async () => {
    const html = await renderLabelHtml(mockPrisma(null), BASE_JOB, "", {
      noAutoPrint: true,
    });
    expect(html).not.toContain("label-print.js");
  });
});

describe("renderReceiptHtml signature seal provenance", () => {
  const A4 = { ...FULL_SETTINGS, receiptPaper: "a4" };

  it("prints the terms version and date on the seal of the final receipt", async () => {
    const prisma = mockPrisma({ ...A4, intakeTerms: "Termos custom da loja" });
    const job = {
      ...BASE_JOB,
      intakeDocumentHash: "abcdef1234567890",
      intakeTermsSnapshot: {
        locale: "pt",
        termsText: "Termos custom da loja",
      },
      intakeTermsUpdatedAt: new Date("2026-11-20T10:00:00Z"),
      intakeTermsVersion: 3,
      signedAt: new Date("2026-11-21T15:00:00Z"),
    };
    const html = await renderReceiptHtml(prisma, job, "", {});
    expect(html).toContain("termos v3");
    expect(html).toContain("20/11/2026");
  });
});

describe("termsProvenanceLine", () => {
  const s = receiptStrings("pt");

  it("shows the version date when the edit date exists", async () => {
    const line = await termsProvenanceLine(
      {
        intakeTermsVersion: 3,
        intakeTermsUpdatedAt: new Date("2026-11-20T10:00:00Z"),
      },
      s
    );
    expect(line).toContain("termos v3");
    expect(line).toContain("20/11/2026");
    expect(line).not.toContain("desconhecida");
  });

  it("discloses the unknown date for pre-migration custom terms", async () => {
    const line = await termsProvenanceLine(
      {
        intakeTermsSnapshot: { locale: "pt", termsText: "Texto custom antigo" },
        intakeTermsUpdatedAt: null,
        intakeTermsVersion: 1,
      },
      s
    );
    expect(line).toContain("data da versão desconhecida");
    expect(line).toContain("2026-11-26");
  });

  it("omits provenance for the bundled default clauses — no false antiquity claim", async () => {
    const pt = await import("../../../src/i18n/locales/pt.json");
    const defaultText = (pt.default as { intake?: { terms_text?: string } })
      .intake?.terms_text;
    const line = await termsProvenanceLine(
      {
        intakeTermsSnapshot: { locale: "pt", termsText: defaultText },
        intakeTermsUpdatedAt: null,
        intakeTermsVersion: 1,
      },
      s
    );
    expect(line).toBe("");
  });

  it("omits provenance for jobs signed before versioning existed", async () => {
    const line = await termsProvenanceLine({}, s);
    expect(line).toBe("");
  });

  it("omits the shop version for bundled default terms even when reverting stamped a date", async () => {
    const pt = await import("../../../src/i18n/locales/pt.json");
    const defaultText = (
      pt.default as { intake?: { terms_text?: string } }
    ).intake?.terms_text;
    const line = await termsProvenanceLine(
      {
        intakeTermsSnapshot: { locale: "pt", termsText: defaultText },
        intakeTermsUpdatedAt: new Date("2026-11-20T10:00:00Z"),
        intakeTermsVersion: 3,
      },
      s
    );
    expect(line).toBe("");
  });
});
