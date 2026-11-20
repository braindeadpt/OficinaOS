import { canonicalize } from "@shared/intake-document.js";
import {
  buildLoanerAgreementDocument,
  LOANER_AGREEMENT_DOC_KIND,
  LOANER_AGREEMENT_DOC_VERSION,
  type LoanerAgreementSource,
  loanerAgreementMatches,
  publicLoanerAgreementView,
} from "@shared/loaner-agreement-document.js";
import { describe, expect, it } from "vitest";

const SOURCE: LoanerAgreementSource = {
  jobCode: "R-2026-0001",
  createdAt: new Date("2026-11-21T10:00:00Z"),
  estimatedDate: new Date("2026-11-24T18:00:00Z"),
  imei: "356789104567890",
  loanerDevice: {
    label: "Loja #1",
    brand: "Nokia",
    model: "105",
    imei: "111222333444555",
  },
  loanerNote: "Loja #1 (Nokia 105) · IMEI 111222333444555",
  customer: { name: "Maria Silva", phone: "912345678", taxId: "214365879" },
  device: { brand: { name: "Apple" }, model: "iPhone 14" },
};

describe("buildLoanerAgreementDocument", () => {
  it("freezes the agreement the customer signs — unit, customer, clauses, dates", () => {
    const doc = buildLoanerAgreementDocument(SOURCE, "pt");
    expect(doc.doc).toBe(LOANER_AGREEMENT_DOC_KIND);
    expect(doc.v).toBe(LOANER_AGREEMENT_DOC_VERSION);
    expect(doc.jobCode).toBe("R-2026-0001");
    expect(doc.unit?.label).toBe("Loja #1");
    expect(doc.clauses.length).toBeGreaterThan(0);
    expect(doc.acceptance).toContain("aceito");
  });

  it("is deterministic — same input rebuilds identical canonical bytes", () => {
    const a = buildLoanerAgreementDocument(SOURCE, "pt");
    const b = buildLoanerAgreementDocument(
      JSON.parse(JSON.stringify(SOURCE)) as LoanerAgreementSource,
      "pt"
    );
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("binds to the locale — different language, different document", () => {
    const pt = buildLoanerAgreementDocument(SOURCE, "pt");
    const en = buildLoanerAgreementDocument(SOURCE, "en");
    expect(canonicalize(pt)).not.toBe(canonicalize(en));
    expect(en.clauses[0]).toContain("shop's property");
  });

  it("works without a fleet unit — the note alone identifies the loan", () => {
    const doc = buildLoanerAgreementDocument(
      { ...SOURCE, loanerDevice: null },
      "pt"
    );
    expect(doc.unit).toBeNull();
    expect(doc.note).toBe(SOURCE.loanerNote);
  });
});

describe("loanerAgreementMatches", () => {
  const snapshot = buildLoanerAgreementDocument(SOURCE, "pt");

  it("accepts the job that still produces the signed document", () => {
    expect(loanerAgreementMatches(snapshot, SOURCE)).toBe(true);
  });

  it("rejects a swapped fleet unit", () => {
    expect(
      loanerAgreementMatches(snapshot, {
        ...SOURCE,
        loanerDevice: {
          label: "Loja #2",
          brand: "Nokia",
          model: "105",
          imei: null,
        },
      })
    ).toBe(false);
  });

  it("rejects an edited note, customer or expected return", () => {
    expect(
      loanerAgreementMatches(snapshot, { ...SOURCE, loanerNote: "outra nota" })
    ).toBe(false);
    expect(
      loanerAgreementMatches(snapshot, {
        ...SOURCE,
        customer: { ...SOURCE.customer, name: "Joana" },
      })
    ).toBe(false);
    expect(
      loanerAgreementMatches(snapshot, {
        ...SOURCE,
        estimatedDate: new Date("2026-12-01T00:00:00Z"),
      })
    ).toBe(false);
  });

  it("rejects intake documents and foreign snapshots", () => {
    expect(loanerAgreementMatches(null, SOURCE)).toBe(false);
    expect(loanerAgreementMatches({ doc: "intake" }, SOURCE)).toBe(false);
  });
});

describe("publicLoanerAgreementView", () => {
  const doc = buildLoanerAgreementDocument(SOURCE, "pt");
  const view = publicLoanerAgreementView(doc);

  it("marks the document kind so sign pages can render dedicated labels", () => {
    expect(view.kind).toBe(LOANER_AGREEMENT_DOC_KIND);
    expect(view.unit).toContain("Loja #1");
    expect(view.repairDevice).toBe("Apple iPhone 14");
  });

  it("maps onto the intake public view shape — same page renders it", () => {
    expect(view.customerName).toBe("Maria Silva");
    expect(view.device).toBe(view.unit);
    expect(view.estimatedDelivery).toBe(doc.expectedReturn);
    expect(view.termsText).toContain(doc.clauses[0]);
    expect(view.termsText).toContain(doc.acceptance);
  });

  it("never leaks phone, tax id or IMEI to the public link", () => {
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("912345678");
    expect(serialized).not.toContain("214365879");
    expect(serialized).not.toContain("356789104567890");
    // The unit's own IMEI is printed on the agreement itself — the customer
    // needs to see exactly which device is being lent, unlike the device
    // under repair whose identifiers stay redacted. (Unit IMEI is visible.)
  });

  it("keeps the loaner note visible when a fleet unit is linked", () => {
    // The note is hashed into the snapshot and printed under the signature —
    // hiding it from the signing page would let staff attach undisclosed
    // conditions to a document the customer never reviewed.
    expect(view.note).toBe(doc.note);
    expect(view.note).toBeTruthy();
  });

  it("surfaces the note as the device label when no fleet unit is linked", () => {
    const noUnit = publicLoanerAgreementView(
      buildLoanerAgreementDocument({ ...SOURCE, loanerDevice: null }, "pt")
    );
    expect(noUnit.note).toBeNull();
    expect(noUnit.device).toContain("Nokia 105");
  });
});
