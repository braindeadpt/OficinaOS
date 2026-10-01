import { create } from "zustand";
import type { IntakeFormData } from "@/components/modules/jobs/intake-modal/types";

interface UiState {
  closeIntakeModal: () => void;
  closeMoreSheet: () => void;
  closePrintPreview: () => void;
  closeReportModal: () => void;
  intakeModalOpen: boolean;
  // Set when opening intake from a pre-check request — merged into the form
  // and used to mark the request converted after the job is created.
  intakeModalPrefill: Partial<IntakeFormData> | null;
  intakeRequestId: string | null;
  moreSheetOpen: boolean;
  openIntakeModal: (
    prefill?: Partial<IntakeFormData>,
    requestId?: string
  ) => void;
  openMoreSheet: () => void;
  openReportModal: () => void;
  printPreviewJobId: string | null;
  reportModalOpen: boolean;
  showPrintPreview: (jobId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  intakeModalOpen: false,
  intakeModalPrefill: null,
  intakeRequestId: null,
  moreSheetOpen: false,
  printPreviewJobId: null,
  reportModalOpen: false,

  openIntakeModal: (prefill, requestId) =>
    set({
      intakeModalOpen: true,
      intakeModalPrefill: prefill ?? null,
      intakeRequestId: requestId ?? null,
    }),
  closeIntakeModal: () =>
    set({
      intakeModalOpen: false,
      intakeModalPrefill: null,
      intakeRequestId: null,
    }),
  openMoreSheet: () => set({ moreSheetOpen: true }),
  closeMoreSheet: () => set({ moreSheetOpen: false }),
  showPrintPreview: (jobId: string) => set({ printPreviewJobId: jobId }),
  closePrintPreview: () => set({ printPreviewJobId: null }),
  openReportModal: () => set({ reportModalOpen: true }),
  closeReportModal: () => set({ reportModalOpen: false }),
}));
