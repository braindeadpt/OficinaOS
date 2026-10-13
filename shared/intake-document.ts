// The intake "document" is the frozen record of what the customer saw and
// signed: the terms text (in the language it was shown) plus the ficha data.
// The same canonicalization runs when the remote session is created, when the
// signature lands and when the job is submitted — any drift invalidates the
// link instead of silently signing a different document.

export const INTAKE_DOCUMENT_VERSION = 2;

export interface IntakeRepairLine {
  name: string;
  price: number;
}

export interface IntakeDocument {
  accessories: string[];
  checklist: Record<string, "ok" | "fail" | null>;
  color: string | null;
  conditionNotes: string | null;
  customerEmail: string | null;
  customerName: string;
  customerPhone: string;
  deposit: number | null;
  deviceBrand: string;
  deviceCategory: string | null;
  deviceModel: string;
  estimatedCost: number | null;
  estimatedDelivery: string | null;
  imei: string | null;
  loaner: boolean;
  loanerNote: string | null;
  locale: string;
  problem: string;
  repairs: IntakeRepairLine[];
  termsText: string;
  // Never the code itself — only that one was collected. The PIN/pattern is
  // a device credential, not part of what the customer signs over.
  unlockCodeProvided: boolean;
  urgent: boolean;
  v: number;
  warrantyReturn: boolean;
}

/** Fields a createJob payload and an intake form share, already normalized. */
export interface IntakeDocumentSource {
  accessories?: string[];
  color?: string | null;
  conditionNotes?: string | null;
  customerEmail?: string | null;
  customerName: string;
  customerPhone: string;
  depositAmount?: number | null;
  deviceBrand: string;
  deviceCategory?: string | null;
  deviceModel: string;
  deviceUnlockCode?: string | null;
  estimatedCost?: number | null;
  // Raw "YYYY-MM-DDTHH:mm" string — never a Date, so the canonical form does
  // not depend on either side's timezone.
  estimatedDate?: string | null;
  hasLoanerDevice?: boolean;
  imei?: string | null;
  intakeChecklist?: Record<string, "ok" | "fail" | null>;
  isUrgent?: boolean;
  isWarrantyReturn?: boolean;
  loanerNote?: string | null;
  repairs?: Array<{ repairName: string; price: number }>;
  reportedProblem: string;
}

const emptyToNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Builds the canonical document from a normalized intake payload. Both the
 * intake modal (client, via buildJobPayload output) and the job service
 * (server, from createJobSchema input) feed this same shape, so the snapshot
 * frozen at session creation and the one rebuilt at submit are comparable
 * byte for byte.
 */
export function buildIntakeDocument(
  input: IntakeDocumentSource,
  termsText: string,
  locale: string
): IntakeDocument {
  return {
    v: INTAKE_DOCUMENT_VERSION,
    termsText,
    locale,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerEmail: emptyToNull(input.customerEmail),
    deviceBrand: input.deviceBrand.trim(),
    deviceModel: input.deviceModel.trim(),
    deviceCategory: input.deviceCategory ?? null,
    color: emptyToNull(input.color),
    imei: emptyToNull(input.imei),
    unlockCodeProvided: emptyToNull(input.deviceUnlockCode) !== null,
    problem: input.reportedProblem.trim(),
    conditionNotes: emptyToNull(input.conditionNotes),
    accessories: [...(input.accessories ?? [])].sort(),
    checklist: input.intakeChecklist ?? {},
    estimatedCost: input.estimatedCost ?? null,
    estimatedDelivery: input.estimatedDate ?? null,
    deposit: input.depositAmount ?? null,
    urgent: input.isUrgent ?? false,
    warrantyReturn: input.isWarrantyReturn ?? false,
    loaner: input.hasLoanerDevice ?? false,
    loanerNote: emptyToNull(input.loanerNote),
    repairs: (input.repairs ?? [])
      .map((r) => ({ name: r.repairName, price: r.price }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Deterministic JSON: keys sorted recursively, so hash input is stable. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
    .join(",")}}`;
}

/**
 * What the public /sign page may display — a subset of the frozen document.
 * Contact/identifier fields (phone, email, IMEI, unlock code) never leave the
 * server: the bearer link is easy to photograph.
 */
export function publicDocumentView(doc: IntakeDocument) {
  return {
    accessories: doc.accessories,
    customerName: doc.customerName,
    deposit: doc.deposit,
    device: [doc.deviceBrand, doc.deviceModel, doc.color]
      .filter(Boolean)
      .join(" "),
    estimatedCost: doc.estimatedCost,
    estimatedDelivery: doc.estimatedDelivery,
    problem: doc.problem,
    termsText: doc.termsText,
    urgent: doc.urgent,
  };
}
