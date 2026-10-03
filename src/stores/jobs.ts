import type { JobStatusType } from "@shared/constants";
import type {
  Job,
  JobNote,
  JobPart,
  JobPartsWaiting,
  JobQuote,
  JobRepair,
  Payment,
} from "@shared/types";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

interface JobMetrics {
  [status: string]: number;
}

interface JobsState {
  addNote: (
    jobId: string,
    content: string,
    isCustomerVisible?: boolean
  ) => Promise<JobNote>;
  addPart: (
    jobId: string,
    data: {
      partId?: string;
      partName: string;
      category: string;
      unitPrice: number;
      quantity?: number;
      supplier?: string;
    }
  ) => Promise<JobPart>;
  addPayment: (
    jobId: string,
    data: { method: string; amount: number; reference?: string; note?: string }
  ) => Promise<Payment>;
  addRepair: (
    jobId: string,
    data: {
      repairId?: string;
      repairName: string;
      category: string;
      price: number;
    }
  ) => Promise<JobRepair>;
  addWaitingPart: (
    jobId: string,
    partName: string,
    supplier?: string
  ) => Promise<JobPartsWaiting>;
  clearError: () => void;
  clearPaymentOnDelivery: (jobId: string) => Promise<void>;
  createJob: (data: {
    customerEmail?: string;
    customerId?: string;
    customerName: string;
    customerPhone: string;
    deviceBrand: string;
    deviceBrandId?: string;
    deviceModel: string;
    color?: string;
    imei?: string;
    reportedProblem: string;
    conditionNotes?: string;
    deviceUnlockCode?: string;
    accessories?: string[];
    intakeChecklist?: Record<string, "ok" | "fail" | null>;
    intakeSignatureDataUrl?: string;
    estimatedCost: number;
    estimatedDate?: string;
    depositAmount?: number;
    technicianId?: string;
    isWarrantyReturn?: boolean;
    warrantyForJobId?: string;
    repairs?: Array<{
      repairId?: string;
      repairName: string;
      category: string;
      price: number;
    }>;
  }) => Promise<Job>;
  error: string | null;
  fetchJobById: (id: string) => Promise<Job>;

  fetchJobs: (params?: {
    cursor?: string;
    limit?: number;
    status?: string;
    technicianId?: string;
    search?: string;
  }) => Promise<void>;
  fetchMetrics: () => Promise<void>;
  fetchNotes: (jobId: string) => Promise<JobNote[]>;
  fetchPayments: (
    jobId: string
  ) => Promise<{ paidTotal: number; payments: Payment[] }>;
  fetchQuotes: (jobId: string) => Promise<JobQuote[]>;
  isCreatingJob: boolean;
  isLoadingJobs: boolean;
  isLoadingMetrics: boolean;
  jobs: Job[];
  markPaymentOnDelivery: (jobId: string, method: string) => Promise<void>;
  metrics: JobMetrics | null;
  nextCursor: string | null;
  removePart: (jobId: string, partId: string) => Promise<void>;
  removePayment: (jobId: string, paymentId: string) => Promise<void>;
  removeRepair: (jobId: string, repairId: string) => Promise<void>;
  removeWaitingPart: (jobId: string, waitingId: string) => Promise<void>;
  sendQuote: (
    jobId: string,
    data: { amount?: number; note?: string }
  ) => Promise<JobQuote>;
  totalCount: number;
  transitionStatus: (
    id: string,
    status: JobStatusType,
    reason?: string,
    actualLaborHours?: number
  ) => Promise<Job>;
  updateJob: (id: string, data: Record<string, unknown>) => Promise<Job>;
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: [],
  metrics: null,
  totalCount: 0,
  nextCursor: null,
  isLoadingJobs: false,
  isLoadingMetrics: false,
  isCreatingJob: false,
  error: null,

  fetchJobs: async (params) => {
    set({ isLoadingJobs: true, error: null });
    try {
      const res = await api.get("/jobs", { params });
      set({
        jobs: res.data.jobs,
        nextCursor: res.data.nextCursor ?? null,
        totalCount: res.data.totalCount ?? 0,
        isLoadingJobs: false,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_jobs"));
      set({ isLoadingJobs: false, error: message });
    }
  },

  fetchMetrics: async () => {
    set({ isLoadingMetrics: true, error: null });
    try {
      const res = await api.get("/jobs/metrics");
      set({ metrics: res.data, isLoadingMetrics: false });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_metrics"));
      set({ isLoadingMetrics: false, error: message });
    }
  },

  createJob: async (data) => {
    set({ isCreatingJob: true, error: null });
    try {
      const res = await api.post("/jobs", data);
      const newJob = res.data as Job;
      set((state) => ({
        jobs: [newJob, ...state.jobs],
        totalCount: state.totalCount + 1,
        isCreatingJob: false,
      }));
      return newJob;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.create_job"));
      set({ isCreatingJob: false, error: message });
      throw new Error(message);
    }
  },

  updateJob: async (id, data) => {
    set({ error: null });
    try {
      const res = await api.patch(`/jobs/${id}`, data);
      const updated = res.data as Job;
      set((state) => ({
        jobs: state.jobs.map((j) => (j.id === id ? updated : j)),
      }));
      return updated;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.update_job"));
      set({ error: message });
      throw new Error(message);
    }
  },

  transitionStatus: async (id, status, reason, actualLaborHours) => {
    set({ error: null });
    try {
      const res = await api.patch(`/jobs/${id}/status`, {
        status,
        reason,
        actualLaborHours,
      });
      const updated = res.data as Job;
      set((state) => ({
        jobs: state.jobs.map((j) => (j.id === id ? updated : j)),
      }));
      return updated;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.transition_status"));
      set({ error: message });
      throw new Error(message);
    }
  },

  addNote: async (jobId, content, isCustomerVisible = false) => {
    set({ error: null });
    try {
      const res = await api.post(`/jobs/${jobId}/notes`, {
        content,
        isCustomerVisible,
      });
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId ? { ...j, notes: [...(j.notes ?? []), res.data] } : j
        ),
      }));
      return res.data as JobNote;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.add_note"));
      set({ error: message });
      throw new Error(message);
    }
  },

  fetchNotes: async (jobId) => {
    set({ error: null });
    try {
      const res = await api.get(`/jobs/${jobId}/notes`);
      const notes = res.data as JobNote[];
      set((state) => ({
        jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, notes } : j)),
      }));
      return notes;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_notes"));
      set({ error: message });
      throw new Error(message);
    }
  },

  addWaitingPart: async (jobId, partName, supplier) => {
    set({ error: null });
    try {
      const res = await api.post(`/jobs/${jobId}/waiting-parts`, {
        partName,
        supplier,
      });
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? { ...j, partsWaiting: [...(j.partsWaiting ?? []), res.data] }
            : j
        ),
      }));
      return res.data as JobPartsWaiting;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.add_waiting_part"));
      set({ error: message });
      throw new Error(message);
    }
  },

  addPart: async (jobId, data) => {
    set({ error: null });
    try {
      const res = await api.post(`/jobs/${jobId}/parts`, data);
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? { ...j, partsUsed: [...(j.partsUsed ?? []), res.data] }
            : j
        ),
      }));
      return res.data as JobPart;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.add_part"));
      set({ error: message });
      throw new Error(message);
    }
  },

  removePart: async (jobId, partId) => {
    set({ error: null });
    try {
      await api.delete(`/jobs/${jobId}/parts/${partId}`);
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? {
                ...j,
                partsUsed: (j.partsUsed ?? []).filter((p) => p.id !== partId),
              }
            : j
        ),
      }));
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.remove_part"));
      set({ error: message });
    }
  },

  addRepair: async (jobId, data) => {
    set({ error: null });
    try {
      const res = await api.post(`/jobs/${jobId}/repairs`, data);
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? { ...j, repairs: [...(j.repairs ?? []), res.data] }
            : j
        ),
      }));
      return res.data as JobRepair;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.add_repair"));
      set({ error: message });
      throw new Error(message);
    }
  },

  removeRepair: async (jobId, repairId) => {
    set({ error: null });
    try {
      await api.delete(`/jobs/${jobId}/repairs/${repairId}`);
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? {
                ...j,
                repairs: (j.repairs ?? []).filter((r) => r.id !== repairId),
              }
            : j
        ),
      }));
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.remove_repair"));
      set({ error: message });
    }
  },

  removeWaitingPart: async (jobId, waitingId) => {
    set({ error: null });
    try {
      await api.delete(`/jobs/${jobId}/waiting-parts/${waitingId}`);
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? {
                ...j,
                partsWaiting: (j.partsWaiting ?? []).filter(
                  (wp) => wp.id !== waitingId
                ),
              }
            : j
        ),
      }));
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        i18n.t("errors.remove_waiting_part")
      );
      set({ error: message });
    }
  },

  fetchPayments: async (jobId) => {
    set({ error: null });
    try {
      const res = await api.get(`/payments/${jobId}/payments`);
      return res.data as { paidTotal: number; payments: Payment[] };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_payments"));
      set({ error: message });
      throw new Error(message);
    }
  },

  fetchQuotes: async (jobId) => {
    set({ error: null });
    try {
      const res = await api.get(`/jobs/${jobId}/quotes`);
      return res.data as JobQuote[];
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_quotes"));
      set({ error: message });
      throw new Error(message);
    }
  },

  sendQuote: async (jobId, data) => {
    set({ error: null });
    try {
      const res = await api.post(`/jobs/${jobId}/quotes`, data);
      return res.data as JobQuote;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.send_quote"));
      set({ error: message });
      throw new Error(message);
    }
  },

  addPayment: async (jobId, data) => {
    set({ error: null });
    try {
      const res = await api.post(`/payments/${jobId}/payments`, data);
      return res.data as Payment;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.add_payment"));
      set({ error: message });
      throw new Error(message);
    }
  },

  markPaymentOnDelivery: async (jobId, method) => {
    set({ error: null });
    try {
      await api.post(`/jobs/${jobId}/payment-on-delivery`, { method });
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        i18n.t("errors.mark_payment_on_delivery")
      );
      set({ error: message });
      throw new Error(message);
    }
  },

  clearPaymentOnDelivery: async (jobId) => {
    set({ error: null });
    try {
      await api.delete(`/jobs/${jobId}/payment-on-delivery`);
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        i18n.t("errors.clear_payment_on_delivery")
      );
      set({ error: message });
      throw new Error(message);
    }
  },

  removePayment: async (jobId, paymentId) => {
    set({ error: null });
    try {
      await api.delete(`/payments/${jobId}/payments/${paymentId}`);
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.remove_payment"));
      set({ error: message });
      throw new Error(message);
    }
  },

  clearError: () => set({ error: null }),

  fetchJobById: async (id) => {
    set({ error: null });
    try {
      const res = await api.get(`/jobs/${id}`);
      const job = res.data as Job;
      set((state) => {
        const exists = state.jobs.some((j) => j.id === id);
        return {
          jobs: exists
            ? state.jobs.map((j) => (j.id === id ? job : j))
            : [job, ...state.jobs],
        };
      });
      return job;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_job"));
      set({ error: message });
      throw new Error(message);
    }
  },
}));
