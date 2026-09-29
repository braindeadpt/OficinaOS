import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

const mockFetchParts = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/parts-catalog", () => ({
  usePartsCatalogStore: {
    getState: () => ({ fetchParts: mockFetchParts }),
  },
}));

import { useSalesStore } from "../sales";

const part = {
  category: "SCREEN",
  defaultPrice: 3500,
  id: "part-1",
  name: "iPhone 14 Screen",
  stockQuantity: 3,
};

describe("sales store stock limits", () => {
  beforeEach(() => {
    act(() => {
      useSalesStore.getState().clearCart();
    });
    vi.clearAllMocks();
  });

  it("blocks adding beyond physical stock across repeated taps", () => {
    act(() => {
      const store = useSalesStore.getState();
      store.addCatalogPart(part);
      store.addCatalogPart(part);
      store.addCatalogPart(part);
      store.addCatalogPart(part); // 4th tap exceeds stock of 3
    });

    const { cart } = useSalesStore.getState();
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it("blocks incrementing a line above its stock", () => {
    act(() => {
      useSalesStore.getState().addCatalogPart(part);
    });
    act(() => {
      const store = useSalesStore.getState();
      store.updateQuantity(0, 99);
    });

    const { cart } = useSalesStore.getState();
    expect(cart[0].quantity).toBe(3);
  });

  it("returns the freed stock when a line is removed", () => {
    act(() => {
      useSalesStore.getState().addCatalogPart(part);
    });
    act(() => {
      useSalesStore.getState().removeLine(0);
    });

    // Removing frees stock: the catalog grid shows it as available again.
    const { cart } = useSalesStore.getState();
    expect(cart).toHaveLength(0);
  });

  it("caps re-adding at the remaining stock", () => {
    act(() => {
      const store = useSalesStore.getState();
      store.addCatalogPart(part); // 1
      store.addCatalogPart(part); // 2
    });

    // Catalog refresh is keyed on stock; a re-add with stale stock of 2
    // must not push the line beyond physical stock of 3.
    act(() => {
      useSalesStore.getState().addCatalogPart({ ...part, stockQuantity: 2 });
    });

    const { cart } = useSalesStore.getState();
    expect(cart[0].quantity).toBe(2);
  });

  it("refreshes the catalog stock after a successful checkout", async () => {
    act(() => {
      useSalesStore.getState().addCatalogPart(part);
    });
    mockPost.mockResolvedValue({
      data: { id: "sale-1", saleCode: "SALE-2026-000001" },
    });

    await act(async () => {
      await useSalesStore
        .getState()
        .checkout([{ amount: 3500, method: "CASH" }]);
    });

    expect(mockFetchParts).toHaveBeenCalled();
    const { cart } = useSalesStore.getState();
    expect(cart).toHaveLength(0);
  });
});
