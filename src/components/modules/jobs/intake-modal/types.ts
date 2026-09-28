export interface PhotoPreview {
  file: File;
  url: string;
}

export interface SelectedRepair {
  category: string;
  price: number;
  repairId: string;
  repairName: string;
}

export interface IntakeFormData {
  brand: string;
  brandId: string;
  color: string;
  conditionNotes: string;
  customerEmail: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deposit: string;
  estimatedCost: string;
  estimatedDelivery: string;
  imei: string;
  isWarrantyReturn: boolean;
  model: string;
  modelId: string;
  photos: File[];
  repairs: SelectedRepair[];
  reportedProblem: string;
}

export const MAX_PHOTOS = 5;

export const INITIAL_FORM: IntakeFormData = {
  brand: "",
  brandId: "",
  color: "",
  conditionNotes: "",
  imei: "",
  customerEmail: "",
  customerId: "",
  customerName: "",
  customerPhone: "",
  deposit: "",
  estimatedCost: "",
  estimatedDelivery: new Date().toISOString().split("T")[0],
  isWarrantyReturn: false,
  model: "",
  modelId: "",
  photos: [],
  repairs: [],
  reportedProblem: "",
};

export interface IntakeModalProps {
  onClose: () => void;
  onSubmit: (data: IntakeFormData) => Promise<void>;
  open: boolean;
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
