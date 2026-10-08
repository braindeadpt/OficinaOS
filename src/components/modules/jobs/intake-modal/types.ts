export interface PhotoPreview {
  file: File;
  url: string;
}

export type CheckState = "ok" | "fail" | null;
export type IntakeChecklist = Record<string, CheckState>;

export interface IntakeFormData {
  accessories: string[];
  brand: string;
  brandId: string;
  checklist: IntakeChecklist;
  color: string;
  conditionNotes: string;
  customerEmail: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deposit: string;
  deviceCategory: string;
  deviceUnlockCode: string;
  estimatedCost: string;
  estimatedDelivery: string;
  hasLoanerDevice: boolean;
  imei: string;
  isUrgent: boolean;
  isWarrantyReturn: boolean;
  loanerNote: string;
  model: string;
  modelId: string;
  photos: File[];
  reportedProblem: string;
  signature: string | null;
}

export const MAX_PHOTOS = 5;

export const INTAKE_ACCESSORY_ITEMS = [
  "charger",
  "case",
  "simCard",
  "sdCard",
  "box",
  "other",
] as const;

export const INTAKE_CHECK_ITEMS = [
  "powersOn",
  "screen",
  "touch",
  "cameras",
  "audio",
  "charging",
] as const;

/**
 * Default promise: today at 18:00 — or tomorrow at 18:00 once it is past
 * 17:00, so a late check-in never opens with a delivery time in the past.
 */
export function defaultDeliveryDatetime(now: Date = new Date()): string {
  const d = new Date(now);
  if (now.getHours() >= 17) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(18, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const INITIAL_FORM: IntakeFormData = {
  accessories: [],
  brand: "",
  brandId: "",
  checklist: {},
  color: "",
  conditionNotes: "",
  deviceUnlockCode: "",
  imei: "",
  customerEmail: "",
  customerId: "",
  customerName: "",
  customerPhone: "",
  deposit: "",
  deviceCategory: "phone",
  hasLoanerDevice: false,
  loanerNote: "",
  estimatedCost: "",
  estimatedDelivery: defaultDeliveryDatetime(),
  isUrgent: false,
  isWarrantyReturn: false,
  model: "",
  modelId: "",
  photos: [],
  reportedProblem: "",
  signature: null,
};

export interface IntakeModalProps {
  onClose: () => void;
  onSubmit: (data: IntakeFormData) => Promise<void>;
  open: boolean;
  /** Pre-checked intake request conversion — merged over INITIAL_FORM on open. */
  prefill?: Partial<IntakeFormData>;
}

export const labelCls =
  "mb-1.5 ms-1 block font-label text-xs font-bold uppercase tracking-wide text-on-surface-variant";
export const inputCls =
  "h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary";
export const inputErrorCls =
  "h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface ring-2 ring-error transition-all focus:bg-surface-container-lowest focus:ring-primary";
export const textareaCls =
  "w-full resize-none rounded-xl bg-surface-container-low p-4 text-sm text-on-surface transition-all placeholder:text-outline focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary";
export const textareaErrorCls =
  "w-full resize-none rounded-xl bg-surface-container-low p-4 text-sm text-on-surface ring-2 ring-error transition-all placeholder:text-outline focus:bg-surface-container-lowest focus:ring-primary";
export const errorCls = "ms-1 mt-1 font-label text-xs font-medium text-error";
export const requiredMarkCls = "ms-0.5 text-error";

export const REQUIRED_FIELDS: (keyof IntakeFormData)[] = [
  "customerName",
  "customerPhone",
  "model",
  "reportedProblem",
];

type IntakeStep = 1 | 2;
type ServerFieldTarget = [keyof IntakeFormData, IntakeStep];

/** POST /jobs payload keys → the intake form field (and step) they came from. */
const SERVER_FIELD_MAP: Record<string, ServerFieldTarget> = {
  accessories: ["accessories", 2],
  color: ["color", 1],
  conditionNotes: ["conditionNotes", 2],
  customerEmail: ["customerEmail", 1],
  customerId: ["customerName", 1],
  customerName: ["customerName", 1],
  customerPhone: ["customerPhone", 1],
  depositAmount: ["deposit", 2],
  deviceBrand: ["brand", 1],
  deviceBrandId: ["brand", 1],
  deviceModel: ["model", 1],
  deviceUnlockCode: ["deviceUnlockCode", 1],
  estimatedCost: ["estimatedCost", 2],
  estimatedDate: ["estimatedDelivery", 2],
  hasLoanerDevice: ["hasLoanerDevice", 2],
  loanerNote: ["loanerNote", 2],
  imei: ["imei", 1],
  intakeChecklist: ["checklist", 2],
  intakeSignatureDataUrl: ["signature", 2],
  reportedProblem: ["reportedProblem", 2],
};

export interface MappedServerErrors {
  errors: Partial<Record<keyof IntakeFormData, string>>;
  /** First step holding an invalid field — where the modal should go back to. */
  step: IntakeStep | null;
}

/**
 * Turns a VALIDATION_ERROR from POST /jobs ({ details: { errors: { imei:
 * ["IMEI inválido"] } } }) into form-field errors plus the step to show,
 * so the real problem is marked on the field instead of a generic toast.
 */
export function mapServerFieldErrors(err: unknown): MappedServerErrors {
  const details = (err as { details?: { errors?: unknown } } | null)?.details;
  const raw = details?.errors;
  const result: MappedServerErrors = { errors: {}, step: null };
  if (!raw || typeof raw !== "object") {
    return result;
  }
  for (const [key, messages] of Object.entries(raw)) {
    const target = SERVER_FIELD_MAP[key];
    const message = Array.isArray(messages) ? messages[0] : messages;
    if (!(target && typeof message === "string")) {
      continue;
    }
    const [field, step] = target;
    result.errors[field] ??= message;
    if (result.step === null || step < result.step) {
      result.step = step;
    }
  }
  return result;
}
