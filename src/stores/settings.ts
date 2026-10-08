import type {
  AiSettings,
  NotificationTemplate,
  ShopSettings,
} from "@shared/types";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

interface OutboxLog {
  channel: string;
  createdAt: string;
  error: string | null;
  id: string;
  jobId: string | null;
  recipientPhone: string;
  status: string;
  templateName: string;
}

interface InvoicingSettings {
  account: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  module: boolean;
  taxName: string;
}

interface SmsSettings {
  enabled: boolean;
  gatewayUrl: string | null;
  gatewayUser: string | null;
  hasPassword: boolean;
  inboundPath: string | null;
  moduleEnabled: boolean;
}

interface WhatsAppSettings {
  businessId: string | null;
  credentialsAtCloud: boolean;
  enabled: boolean;
  hasApiToken: boolean;
  phoneNumberId: string | null;
  remarketingCooldownDays: number;
  remarketingDays: number;
  remarketingEnabled: boolean;
  remarketingModule: boolean;
  remarketingTemplate: string | null;
  trackingBaseUrl: string | null;
}

interface SettingsState {
  aiSettings: AiSettings | null;
  cancelOutboxEntry: (
    id: string
  ) => Promise<{ success: boolean; message?: string }>;
  clearError: () => void;
  error: string | null;
  fetchAiSettings: () => Promise<void>;
  fetchInvoicingSettings: () => Promise<void>;
  fetchNotificationTemplates: () => Promise<void>;
  fetchOutboxLogs: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  fetchShopSettings: () => Promise<void>;
  fetchSmsSettings: () => Promise<void>;
  fetchWhatsAppSettings: () => Promise<void>;
  invoicingSettings: InvoicingSettings | null;
  isLoading: boolean;
  notificationTemplates: NotificationTemplate[];
  outboxLogs: OutboxLog[];
  registerSmsWebhook: () => Promise<{ ok: boolean; message?: string }>;
  saveAiSettings: (data: {
    endpointUrl?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    enabled?: boolean;
  }) => Promise<AiSettings>;
  saveInvoicingSettings: (data: {
    account?: string;
    apiKey?: string;
    enabled?: boolean;
    taxName?: string;
  }) => Promise<void>;
  saveShopSettings: (data: {
    shopName: string;
    address?: string;
    phone?: string;
    countryCode?: string;
    currency?: string;
    receiptFooter?: string;
    receiptPaper?: "58mm" | "80mm" | "a4";
    receiptShowImei?: boolean;
    receiptShowProblem?: boolean;
    receiptShowSignature?: boolean;
    receiptShowQr?: boolean;
    receiptShowWarranty?: boolean;
    labelSize?: "40x20" | "57x32" | "62x29";
    printerMode?: "browser" | "escpos";
    printerHost?: string | null;
    printerPort?: number;
    monthlyRevenueGoal?: number | null;
    reviewUrl?: string;
  }) => Promise<ShopSettings>;
  saveSmsSettings: (data: {
    enabled?: boolean;
    gatewayPassword?: string;
    gatewayUrl?: string;
    gatewayUser?: string;
  }) => Promise<{ webhookRegistered: boolean }>;
  saveWhatsAppSettings: (data: {
    apiToken?: string;
    businessId?: string;
    phoneNumberId?: string;
    enabled?: boolean;
    trackingBaseUrl?: string;
    remarketingEnabled?: boolean;
    remarketingDays?: number;
    remarketingCooldownDays?: number;
    remarketingTemplate?: string;
  }) => Promise<void>;
  sendSmsTest: (phone?: string) => Promise<{ ok: boolean; message?: string }>;
  sendTestNotification: (templateId: string) => Promise<{
    message: string;
    success: boolean;
  }>;
  shopSettings: ShopSettings | null;
  smsSettings: SmsSettings | null;
  testAiConnection: () => Promise<{ success: boolean; message: string }>;
  updateNotificationTemplate: (
    id: string,
    data: {
      name: string;
      channel: "WHATSAPP" | "IN_APP" | "SMS";
      body: string;
      isDefault?: boolean;
    }
  ) => Promise<NotificationTemplate>;
  whatsAppSettings: WhatsAppSettings | null;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  aiSettings: null,
  shopSettings: null,
  notificationTemplates: [],
  invoicingSettings: null,
  outboxLogs: [],
  smsSettings: null,
  whatsAppSettings: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/settings");
      set({
        aiSettings: res.data.ai,
        shopSettings: res.data.shop,
        isLoading: false,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      set({ isLoading: false, error: message });
    }
  },

  fetchAiSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/settings/ai");
      set({ aiSettings: res.data, isLoading: false });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_ai_settings"));
      set({ isLoading: false, error: message });
    }
  },

  saveAiSettings: async (data) => {
    set({ error: null });
    try {
      const res = await api.put("/settings/ai", data);
      const updated = res.data as AiSettings;
      set({ aiSettings: updated });
      return updated;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.save_ai_settings"));
      set({ error: message });
      throw new Error(message);
    }
  },

  testAiConnection: async () => {
    set({ error: null });
    try {
      const res = await api.post("/settings/ai/test");
      return res.data as { success: boolean; message: string };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.test_ai_connection"));
      set({ error: message });
      return { success: false, message };
    }
  },

  fetchShopSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/settings/shop");
      set({ shopSettings: res.data, isLoading: false });
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        i18n.t("errors.fetch_shop_settings")
      );
      set({ isLoading: false, error: message });
    }
  },

  saveShopSettings: async (data) => {
    set({ error: null });
    try {
      const res = await api.put("/settings/shop", data);
      const updated = res.data as ShopSettings;
      set({ shopSettings: updated });
      return updated;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.save_shop_settings"));
      set({ error: message });
      throw new Error(message);
    }
  },

  fetchNotificationTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/notifications/templates");
      set({ notificationTemplates: res.data, isLoading: false });
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        i18n.t("errors.fetch_notifications")
      );
      set({ isLoading: false, error: message });
    }
  },

  updateNotificationTemplate: async (id, data) => {
    set({ error: null });
    try {
      const res = await api.put(`/notifications/templates/${id}`, data);
      const updated = res.data as NotificationTemplate;
      set((state) => ({
        notificationTemplates: state.notificationTemplates.map((t) =>
          t.id === id ? updated : t
        ),
      }));
      return updated;
    } catch (err: unknown) {
      const message = getErrorMessage(
        err,
        i18n.t("errors.update_notification_template")
      );
      set({ error: message });
      throw new Error(message);
    }
  },

  fetchInvoicingSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/settings/invoicing");
      set({ invoicingSettings: res.data, isLoading: false });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      set({ isLoading: false, error: message });
    }
  },

  saveInvoicingSettings: async (data) => {
    set({ error: null });
    try {
      await api.put("/settings/invoicing", data);
      await useSettingsStore.getState().fetchInvoicingSettings();
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.save_shop_settings"));
      set({ error: message });
      throw new Error(message);
    }
  },

  fetchWhatsAppSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/settings/whatsapp");
      set({ whatsAppSettings: res.data, isLoading: false });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      set({ isLoading: false, error: message });
    }
  },

  fetchSmsSettings: async () => {
    set({ error: null });
    try {
      const res = await api.get("/settings/sms");
      set({ smsSettings: res.data });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      set({ error: message });
    }
  },

  saveSmsSettings: async (data) => {
    set({ error: null });
    try {
      const res = await api.put("/settings/sms", data);
      const { webhookRegistered: _wr, ...settings } =
        res.data as SmsSettings & {
          webhookRegistered: boolean;
        };
      set({ smsSettings: settings });
      return { webhookRegistered: Boolean(_wr) };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.save_shop_settings"));
      set({ error: message });
      throw new Error(message);
    }
  },

  sendSmsTest: async (phone) => {
    set({ error: null });
    try {
      await api.post("/settings/sms/test", phone ? { phone } : {});
      return { ok: true };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.sms_test_failed"));
      set({ error: message });
      return { message, ok: false };
    }
  },

  registerSmsWebhook: async () => {
    set({ error: null });
    try {
      await api.post("/settings/sms/webhook");
      return { ok: true };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.sms_webhook_failed"));
      set({ error: message });
      return { message, ok: false };
    }
  },

  saveWhatsAppSettings: async (data) => {
    set({ error: null });
    try {
      await api.put("/settings/whatsapp", data);
      await useSettingsStore.getState().fetchWhatsAppSettings();
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.save_shop_settings"));
      set({ error: message });
      throw new Error(message);
    }
  },

  sendTestNotification: async (templateId) => {
    try {
      const res = await api.post(`/notifications/test/${templateId}`);
      return res.data as { message: string; success: boolean };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      return { success: false, message };
    }
  },

  fetchOutboxLogs: async () => {
    try {
      const res = await api.get("/notifications/outbox");
      set({ outboxLogs: res.data });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      set({ error: message });
    }
  },

  cancelOutboxEntry: async (id) => {
    try {
      await api.delete(`/notifications/outbox/${id}`);
      return { success: true };
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_settings"));
      return { success: false, message };
    }
  },

  clearError: () => set({ error: null }),
}));
