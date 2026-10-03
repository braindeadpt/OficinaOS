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
  deviceUnlockCode: string;
  estimatedCost: string;
  estimatedDelivery: string;
  imei: string;
  isUrgent: boolean;
  isWarrantyReturn: boolean;
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

export function defaultDeliveryDatetime(): string {
  const d = new Date();
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
