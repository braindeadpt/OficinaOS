import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
  getErrorMessage: (err: unknown, fallback: string) => {
    if (typeof err === "object" && err !== null && "code" in err) {
      return (err as { message?: string }).message || fallback;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return fallback;
  },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

import { useSettingsStore } from "../settings";

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    aiSettings: null,
    shopSettings: null,
    notificationTemplates: [],
    outboxLogs: [],
    whatsAppSettings: null,
    isLoading: false,
    error: null,
  });
});

describe("useSettingsStore", () => {
  describe("fetchAiSettings", () => {
    it("populates aiSettings", async () => {
      const aiData = {
        id: "ai-1",
        endpointUrl: "https://api.openai.com",
        model: "gpt-4",
        temperature: 0.7,
      };
      mockGet.mockResolvedValue({ data: aiData });

      await act(() => useSettingsStore.getState().fetchAiSettings());

      const state = useSettingsStore.getState();
      expect(state.aiSettings).toEqual(aiData);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockGet.mockRejectedValue(new Error("Fetch failed"));

      await act(() => useSettingsStore.getState().fetchAiSettings());

      expect(useSettingsStore.getState().error).toBe("Fetch failed");
      expect(useSettingsStore.getState().isLoading).toBe(false);
    });
  });

  describe("saveAiSettings", () => {
    it("calls API put and updates store", async () => {
      const updated = {
        id: "ai-1",
        endpointUrl: "https://api.openai.com",
        model: "gpt-4o",
        temperature: 0.5,
      };
      mockPut.mockResolvedValue({ data: updated });

      const result = await act(() =>
        useSettingsStore.getState().saveAiSettings({
          endpointUrl: "https://api.openai.com",
          model: "gpt-4o",
          temperature: 0.5,
        })
      );

      expect(result).toEqual(updated);
      expect(useSettingsStore.getState().aiSettings).toEqual(updated);
      expect(mockPut).toHaveBeenCalledWith("/settings/ai", {
        endpointUrl: "https://api.openai.com",
        model: "gpt-4o",
        temperature: 0.5,
      });
    });

    it("sets error and throws on API failure", async () => {
      mockPut.mockRejectedValue(new Error("Save failed"));

      await expect(
        act(() =>
          useSettingsStore.getState().saveAiSettings({
            endpointUrl: "https://api.openai.com",
          })
        )
      ).rejects.toThrow("Save failed");

      expect(useSettingsStore.getState().error).toBe("Save failed");
    });
  });

  describe("fetchShopSettings", () => {
    it("populates shopSettings", async () => {
      const shopData = {
        id: "shop-1",
        shopName: "OficinaOS",
        address: "123 Main St",
        phone: "555-0100",
        currency: "USD",
      };
      mockGet.mockResolvedValue({ data: shopData });

      await act(() => useSettingsStore.getState().fetchShopSettings());

      const state = useSettingsStore.getState();
      expect(state.shopSettings).toEqual(shopData);
      expect(state.isLoading).toBe(false);
    });

    it("sets error on API failure", async () => {
      mockGet.mockRejectedValue(new Error("Shop fetch failed"));

      await act(() => useSettingsStore.getState().fetchShopSettings());

      expect(useSettingsStore.getState().error).toBe("Shop fetch failed");
      expect(useSettingsStore.getState().isLoading).toBe(false);
    });
  });

  describe("saveShopSettings", () => {
    it("calls API put and updates store", async () => {
      const updated = {
        id: "shop-1",
        shopName: "OficinaOS Pro",
        address: "456 Oak Ave",
        phone: "555-0200",
        currency: "EUR",
      };
      mockPut.mockResolvedValue({ data: updated });

      const result = await act(() =>
        useSettingsStore.getState().saveShopSettings({
          shopName: "OficinaOS Pro",
          address: "456 Oak Ave",
          phone: "555-0200",
          currency: "EUR",
        })
      );

      expect(result).toEqual(updated);
      expect(useSettingsStore.getState().shopSettings).toEqual(updated);
      expect(mockPut).toHaveBeenCalledWith("/settings/shop", {
        shopName: "OficinaOS Pro",
        address: "456 Oak Ave",
        phone: "555-0200",
        currency: "EUR",
      });
    });

    it("sets error and throws on API failure", async () => {
      mockPut.mockRejectedValue(new Error("Shop save failed"));

      await expect(
        act(() =>
          useSettingsStore.getState().saveShopSettings({
            shopName: "Fail",
          })
        )
      ).rejects.toThrow("Shop save failed");

      expect(useSettingsStore.getState().error).toBe("Shop save failed");
    });
  });

  describe("fetchNotificationTemplates", () => {
    it("populates notificationTemplates", async () => {
      const templates = [
        { id: "tmpl-1", name: "Ready for Pickup", channel: "WHATSAPP" },
        { id: "tmpl-2", name: "Job Completed", channel: "IN_APP" },
      ];
      mockGet.mockResolvedValue({ data: templates });

      await act(() => useSettingsStore.getState().fetchNotificationTemplates());

      const state = useSettingsStore.getState();
      expect(state.notificationTemplates).toEqual(templates);
      expect(state.isLoading).toBe(false);
    });

    it("sets error on API failure", async () => {
      mockGet.mockRejectedValue(new Error("Templates failed"));

      await act(() => useSettingsStore.getState().fetchNotificationTemplates());

      expect(useSettingsStore.getState().error).toBe("Templates failed");
    });
  });

  describe("testAiConnection", () => {
    it("calls API and returns result", async () => {
      mockPost.mockResolvedValue({
        data: { success: true, message: "Connected" },
      });

      const result = await act(() =>
        useSettingsStore.getState().testAiConnection()
      );

      expect(result).toEqual({ success: true, message: "Connected" });
      expect(mockPost).toHaveBeenCalledWith("/settings/ai/test");
    });

    it("returns failure on API error", async () => {
      mockPost.mockRejectedValue(new Error("Connection refused"));

      const result = await act(() =>
        useSettingsStore.getState().testAiConnection()
      );

      expect(result).toEqual({
        success: false,
        message: "Connection refused",
      });
      expect(useSettingsStore.getState().error).toBe("Connection refused");
    });
  });

  describe("fetchWhatsAppSettings", () => {
    it("populates whatsAppSettings", async () => {
      const waData = {
        enabled: true,
        businessId: "biz-123",
        phoneNumberId: "phone-456",
        hasApiToken: true,
      };
      mockGet.mockResolvedValue({ data: waData });

      await act(() => useSettingsStore.getState().fetchWhatsAppSettings());

      const state = useSettingsStore.getState();
      expect(state.whatsAppSettings).toEqual(waData);
      expect(state.isLoading).toBe(false);
    });

    it("sets error on API failure", async () => {
      mockGet.mockRejectedValue(new Error("WA fetch failed"));

      await act(() => useSettingsStore.getState().fetchWhatsAppSettings());

      expect(useSettingsStore.getState().error).toBe("WA fetch failed");
    });
  });

  describe("saveWhatsAppSettings", () => {
    it("calls API put and refreshes whatsAppSettings", async () => {
      mockPut.mockResolvedValue({});
      const refreshed = {
        enabled: true,
        businessId: "biz-new",
        phoneNumberId: "phone-new",
        hasApiToken: true,
      };
      mockGet.mockResolvedValue({ data: refreshed });

      await act(() =>
        useSettingsStore.getState().saveWhatsAppSettings({
          businessId: "biz-new",
          phoneNumberId: "phone-new",
          enabled: true,
        })
      );

      expect(mockPut).toHaveBeenCalledWith("/settings/whatsapp", {
        businessId: "biz-new",
        phoneNumberId: "phone-new",
        enabled: true,
      });
      expect(useSettingsStore.getState().whatsAppSettings).toEqual(refreshed);
    });

    it("sets error and throws on API failure", async () => {
      mockPut.mockRejectedValue(new Error("WA save failed"));

      await expect(
        act(() =>
          useSettingsStore.getState().saveWhatsAppSettings({
            enabled: false,
          })
        )
      ).rejects.toThrow("WA save failed");

      expect(useSettingsStore.getState().error).toBe("WA save failed");
    });
  });

  describe("clearError", () => {
    it("resets error state", () => {
      useSettingsStore.setState({ error: "Some error" });

      useSettingsStore.getState().clearError();

      expect(useSettingsStore.getState().error).toBeNull();
    });
  });
});
