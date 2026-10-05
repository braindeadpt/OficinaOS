import type { Customer } from "@shared/types";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

interface CustomerJob {
  createdAt: string;
  deviceModel: string;
  estimatedCost: number;
  finalCost: number;
  id: string;
  jobCode: string;
  reportedProblem: string;
  status: string;
}

interface CustomerDetail {
  createdAt: string;
  email: string | null;
  id: string;
  jobs: CustomerJob[];
  name: string;
  phone: string;
  updatedAt: string;
}

interface CustomerListItem {
  _count: { jobs: number };
  email: string | null;
  id: string;
  name: string;
  phone: string;
  whatsappConsent?: boolean;
  whatsappConsentAt?: string | null;
}

interface ConsentSummary {
  optedIn: number;
  optedOut: number;
}

interface CustomersState {
  clearError: () => void;
  consentSummary: ConsentSummary;
  currentCustomer: CustomerDetail | null;
  customers: CustomerListItem[];
  error: string | null;
  exportCustomersCsv: (
    search?: string,
    consent?: string
  ) => Promise<CustomerListItem[]>;
  fetchCustomer: (id: string) => Promise<void>;
  fetchCustomers: (search?: string, consent?: string) => Promise<void>;
  isExporting: boolean;
  isLoading: boolean;
  isLoadingCustomer: boolean;
  isUpdating: boolean;
  nextCursor: string | null;
  searchCustomers: (query: string) => Promise<CustomerListItem[]>;
  totalCount: number;
  updateCustomer: (
    id: string,
    data: {
      email?: string;
      name?: string;
      phone?: string;
      taxId?: string;
      whatsappConsent?: boolean;
    }
  ) => Promise<Customer>;
}

export const useCustomersStore = create<CustomersState>((set) => ({
  consentSummary: { optedIn: 0, optedOut: 0 },
  customers: [],
  currentCustomer: null,
  error: null,
  isLoading: false,
  isLoadingCustomer: false,
  isExporting: false,
  isUpdating: false,
  nextCursor: null,
  totalCount: 0,

  // Full-directory export: walks every page of the list endpoint with the
  // active search/consent filters applied, so GDPR campaign and audit
  // exports are complete rather than limited to the first page.
  exportCustomersCsv: async (search, consent) => {
    set({ isExporting: true });
    try {
      const all: CustomerListItem[] = [];
      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const params: Record<string, unknown> = { limit: 100 };
        if (search) {
          params.search = search;
        }
        if (consent) {
          params.consent = consent;
        }
        if (cursor) {
          params.cursor = cursor;
        }
        const res = await api.get("/customers", { params });
        const data = res.data as {
          customers: CustomerListItem[];
          nextCursor: string | null;
        };
        all.push(...data.customers);
        cursor = data.nextCursor ?? undefined;
        hasMore = Boolean(data.nextCursor);
      }
      return all;
    } finally {
      set({ isExporting: false });
    }
  },

  fetchCustomers: async (search, consent) => {
    set({ isLoading: true });
    try {
      const params: Record<string, unknown> = { limit: 50 };
      if (search) {
        params.search = search;
      }
      if (consent) {
        params.consent = consent;
      }
      const res = await api.get("/customers", { params });
      const data = res.data as {
        consentSummary?: ConsentSummary;
        customers: CustomerListItem[];
        nextCursor: string | null;
        totalCount: number;
      };
      set({
        consentSummary: data.consentSummary ?? { optedIn: 0, optedOut: 0 },
        customers: data.customers,
        nextCursor: data.nextCursor,
        totalCount: data.totalCount,
        isLoading: false,
      });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, i18n.t("errors.fetch_customers")),
      });
    }
  },

  searchCustomers: async (query) => {
    try {
      const res = await api.get("/customers/search", {
        params: { q: query, limit: 20 },
      });
      return res.data as CustomerListItem[];
    } catch {
      return [];
    }
  },

  fetchCustomer: async (id) => {
    set({ isLoadingCustomer: true, error: null });
    try {
      const res = await api.get(`/customers/${id}`);
      set({
        currentCustomer: res.data as CustomerDetail,
        isLoadingCustomer: false,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_customer"));
      set({ isLoadingCustomer: false, error: message });
    }
  },

  updateCustomer: async (id, data) => {
    set({ isUpdating: true, error: null });
    try {
      const res = await api.patch(`/customers/${id}`, data);
      return res.data as Customer;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.update_customer"));
      set({ error: message, isUpdating: false });
      throw new Error(message);
    } finally {
      set({ isUpdating: false });
    }
  },

  clearError: () => set({ error: null }),
}));
