import type { CloseCashSessionInput } from "@shared/schemas/cash-session.schema";
import type {
  CashReportDTO,
  CashSessionDTO,
  InsightsReportDTO,
  OperationsReportDTO,
  OrdersReportDTO,
  PartsConsumptionReportDTO,
  ReturnsReportDTO,
  RevenueReportDTO,
  TimeRangePreset,
} from "@shared/types/reports";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

interface ReportsState {
  cash: { data?: CashReportDTO; loading: boolean; error?: string };
  cashSession: {
    data?: CashSessionDTO & { liveReport: CashReportDTO };
    loading: boolean;
    error?: string;
  };
  closeCashSession: (input: CloseCashSessionInput) => Promise<void>;
  customFrom: string | null;
  customTo: string | null;
  fetchCash: () => Promise<void>;
  fetchCashSession: () => Promise<void>;
  fetchInsights: () => Promise<void>;
  fetchOperations: () => Promise<void>;
  fetchOrders: (status?: string) => Promise<void>;
  fetchPartsConsumption: () => Promise<void>;
  fetchReturns: () => Promise<void>;
  fetchRevenue: () => Promise<void>;
  insights: { data?: InsightsReportDTO; loading: boolean; error?: string };
  operations: { data?: OperationsReportDTO; loading: boolean; error?: string };
  orders: { data?: OrdersReportDTO; loading: boolean; error?: string };
  ordersStatus: string | undefined;
  partsConsumption: {
    data?: PartsConsumptionReportDTO;
    loading: boolean;
    error?: string;
  };
  range: TimeRangePreset;
  reopenCashSession: () => Promise<void>;
  returns: { data?: ReturnsReportDTO; loading: boolean; error?: string };
  revenue: { data?: RevenueReportDTO; loading: boolean; error?: string };
  setCustomRange: (from: string, to: string) => void;
  setOrdersStatus: (status?: string) => void;
  setRange: (range: TimeRangePreset) => void;
}

function queryParams(state: ReportsState): string {
  if (state.customFrom && state.customTo) {
    return `?from=${encodeURIComponent(state.customFrom)}&to=${encodeURIComponent(state.customTo)}`;
  }
  return `?range=${state.range}`;
}

export const useReportsStore = create<ReportsState>((set, get) => ({
  range: "30d",
  cash: { loading: false },
  cashSession: { loading: false },
  customFrom: null,
  customTo: null,
  revenue: { loading: false },
  orders: { loading: false },
  ordersStatus: undefined,
  setOrdersStatus: (status) => set({ ordersStatus: status }),
  operations: { loading: false },
  partsConsumption: { loading: false },
  insights: { loading: false },
  returns: { loading: false },

  setRange: (range) => set({ range, customFrom: null, customTo: null }),
  setCustomRange: (from, to) => set({ customFrom: from, customTo: to }),

  fetchRevenue: async () => {
    set({ revenue: { ...get().revenue, loading: true, error: undefined } });
    try {
      const q = queryParams(get());
      const res = await api.get(`/reports/revenue${q}`);
      set({ revenue: { data: res.data as RevenueReportDTO, loading: false } });
    } catch (err: unknown) {
      set({
        revenue: {
          ...get().revenue,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchOrders: async (status?: string) => {
    set({ orders: { ...get().orders, loading: true, error: undefined } });
    try {
      const q = queryParams(get());
      const st = status ? `&status=${status}` : "";
      const res = await api.get(`/reports/orders${q}${st}`);
      set({ orders: { data: res.data as OrdersReportDTO, loading: false } });
    } catch (err: unknown) {
      set({
        orders: {
          ...get().orders,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchOperations: async () => {
    set({
      operations: { ...get().operations, loading: true, error: undefined },
    });
    try {
      const q = queryParams(get());
      const res = await api.get(`/reports/operations${q}`);
      set({
        operations: { data: res.data as OperationsReportDTO, loading: false },
      });
    } catch (err: unknown) {
      set({
        operations: {
          ...get().operations,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchInsights: async () => {
    set({ insights: { ...get().insights, loading: true, error: undefined } });
    try {
      const q = queryParams(get());
      const res = await api.get(`/reports/insights${q}`);
      set({
        insights: { data: res.data as InsightsReportDTO, loading: false },
      });
    } catch (err: unknown) {
      set({
        insights: {
          ...get().insights,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchPartsConsumption: async () => {
    set({
      partsConsumption: {
        ...get().partsConsumption,
        loading: true,
        error: undefined,
      },
    });
    try {
      const q = queryParams(get());
      const res = await api.get(`/reports/parts-consumption${q}`);
      set({
        partsConsumption: {
          data: res.data as PartsConsumptionReportDTO,
          loading: false,
        },
      });
    } catch (err: unknown) {
      set({
        partsConsumption: {
          ...get().partsConsumption,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchCash: async () => {
    set({ cash: { ...get().cash, loading: true, error: undefined } });
    try {
      const res = await api.get("/reports/cash");
      set({ cash: { data: res.data as CashReportDTO, loading: false } });
    } catch (err: unknown) {
      set({
        cash: {
          ...get().cash,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchCashSession: async () => {
    set({
      cashSession: { ...get().cashSession, loading: true, error: undefined },
    });
    try {
      const res = await api.get("/reports/cash/session");
      set({
        cashSession: {
          data: res.data as CashSessionDTO & { liveReport: CashReportDTO },
          loading: false,
        },
      });
    } catch (err: unknown) {
      set({
        cashSession: {
          ...get().cashSession,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  closeCashSession: async (input: CloseCashSessionInput) => {
    const res = await api.post("/reports/cash/close", input);
    set({
      cashSession: {
        data: res.data as CashSessionDTO & { liveReport: CashReportDTO },
        loading: false,
      },
    });
  },

  reopenCashSession: async () => {
    set({
      cashSession: { ...get().cashSession, loading: true, error: undefined },
    });
    try {
      const res = await api.post("/reports/cash/reopen");
      set({
        cashSession: {
          data: res.data as CashSessionDTO & { liveReport: CashReportDTO },
          loading: false,
        },
      });
    } catch (err: unknown) {
      set({
        cashSession: {
          ...get().cashSession,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },

  fetchReturns: async () => {
    set({ returns: { ...get().returns, loading: true, error: undefined } });
    try {
      const q = queryParams(get());
      const res = await api.get(`/reports/returns${q}`);
      set({
        returns: { data: res.data as ReturnsReportDTO, loading: false },
      });
    } catch (err: unknown) {
      set({
        returns: {
          ...get().returns,
          loading: false,
          error: getErrorMessage(err, i18n.t("errors.fetch_reports")),
        },
      });
    }
  },
}));
