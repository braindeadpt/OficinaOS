import type { IntakeFormData } from "@/components/modules/jobs/intake-modal/types";

export function parseOptionalAmount(raw: string): number | undefined {
  if (raw.trim() === "") {
    return;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function buildJobPayload(data: IntakeFormData) {
  return {
    customerEmail: data.customerEmail || undefined,
    customerId: data.customerId || undefined,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    deviceBrand: data.brand || "Unknown",
    deviceBrandId: data.brandId || undefined,
    deviceModel: data.model,
    deviceCategory: data.deviceCategory || undefined,
    color: data.color || undefined,
    imei: data.imei || undefined,
    reportedProblem: data.reportedProblem,
    conditionNotes: data.conditionNotes || undefined,
    deviceUnlockCode: data.deviceUnlockCode || undefined,
    accessories: data.accessories.length > 0 ? data.accessories : undefined,
    intakeChecklist:
      Object.keys(data.checklist).length > 0 ? data.checklist : undefined,
    intakeSignatureDataUrl: data.signature ?? undefined,
    signatureSessionToken: data.signatureSessionToken ?? undefined,
    // Empty = "por orçamentar" (priced after diagnosis) — send nothing
    // rather than a misleading 0.
    estimatedCost: parseOptionalAmount(data.estimatedCost),
    estimatedDate: data.estimatedDelivery || undefined,
    isUrgent: data.isUrgent,
    depositAmount: data.deposit ? Number.parseFloat(data.deposit) : undefined,
    hasLoanerDevice: data.hasLoanerDevice || undefined,
    loanerNote: data.loanerNote || undefined,
  };
}
