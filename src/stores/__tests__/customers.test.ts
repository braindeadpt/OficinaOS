import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
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

import { useCustomersStore } from "../customers";

function makeCustomer(id: string) {
  return {
    _count: { jobs: 1 },
    email: null,
    id,
    name: `Customer ${id}`,
    phone: "+351900000000",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCustomersStore.setState({
    customers: [],
    currentCustomer: null,
    error: null,
    isLoading: false,
    isLoadingCustomer: false,
    isUpdating: false,
    nextCursor: null,
    totalCount: 0,
  });
});

describe("useCustomersStore", () => {
  describe("fetchCustomers", () => {
    it("passes consent param to the API when provided", async () => {
      mockGet.mockResolvedValue({
        data: {
          customers: [makeCustomer("1")],
          nextCursor: null,
          totalCount: 1,
        },
      });

      await act(() =>
        useCustomersStore.getState().fetchCustomers(undefined, "true")
      );

      expect(mockGet).toHaveBeenCalledWith("/customers", {
        params: { consent: "true", limit: 50 },
      });
      expect(useCustomersStore.getState().error).toBeNull();
    });

    it("omits consent param when not provided", async () => {
      mockGet.mockResolvedValue({
        data: { customers: [], nextCursor: null, totalCount: 0 },
      });

      await act(() => useCustomersStore.getState().fetchCustomers());

      const params = mockGet.mock.calls[0][1].params as Record<string, unknown>;
      expect(params).not.toHaveProperty("consent");
      expect(params.limit).toBe(50);
    });

    it("stores customers and totalCount from the response", async () => {
      const customers = [makeCustomer("1"), makeCustomer("2")];
      mockGet.mockResolvedValue({
        data: { customers, nextCursor: "cursor-1", totalCount: 7 },
      });

      await act(() =>
        useCustomersStore.getState().fetchCustomers(undefined, "false")
      );

      const state = useCustomersStore.getState();
      expect(state.customers).toEqual(customers);
      expect(state.totalCount).toBe(7);
      expect(state.nextCursor).toBe("cursor-1");
      expect(state.isLoading).toBe(false);
    });
  });
});
