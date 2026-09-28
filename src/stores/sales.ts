import type { CreateSaleInput } from "@shared/schemas/sale.schema";
import type { Sale } from "@shared/types";
import { create } from "zustand";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";

export interface CartLine {
  category: string;
  name: string;
  partId?: string;
  quantity: number;
  stockQuantity: number | null;
  uid: string;
  unitPrice: number;
}

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `line-${Date.now()}-${uidCounter}`;
}

interface SalesState {
  addCatalogPart: (
    part: {
      id: string;
      name: string;
      category: string;
      defaultPrice: number;
      stockQuantity: number;
    },
    quantity?: number
  ) => void;
  addCustomItem: (item: {
    name: string;
    unitPrice: number;
    quantity?: number;
  }) => void;
  cart: CartLine[];
  cartTotal: number;
  checkout: (
    payments: Array<{
      method: "CASH" | "CARD" | "TRANSFER" | "OTHER";
      amount: number;
      reference?: string;
    }>
  ) => Promise<Sale>;
  clearCart: () => void;
  clearError: () => void;
  error: string | null;
  fetchSales: (params?: { cursor?: string; limit?: number }) => Promise<void>;
  isCheckingOut: boolean;
  isLoadingSales: boolean;
  nextCursorSale: string | null;
  removeLine: (index: number) => void;
  sales: Sale[];
  updateQuantity: (index: number, quantity: number) => void;
}

function computeTotal(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
}

export const useSalesStore = create<SalesState>((set) => ({
  cart: [],
  cartTotal: 0,
  sales: [],
  nextCursorSale: null,
  isLoadingSales: false,
  isCheckingOut: false,
  error: null,

  addCatalogPart: (part, quantity = 1) => {
    set((state) => {
      const idx = state.cart.findIndex((l) => l.partId === part.id);
      if (idx >= 0) {
        const cart = [...state.cart];
        const line = cart[idx];
        cart[idx] = {
          ...line,
          quantity: Math.min(line.quantity + quantity, part.stockQuantity),
        };
        return { cart, cartTotal: computeTotal(cart) };
      }
      const cart = [
        ...state.cart,
        {
          category: part.category,
          name: part.name,
          partId: part.id,
          quantity,
          stockQuantity: part.stockQuantity,
          uid: nextUid(),
          unitPrice: Number(part.defaultPrice ?? 0),
        },
      ];
      return { cart, cartTotal: computeTotal(cart) };
    });
  },

  addCustomItem: (item) => {
    set((state) => {
      const cart = [
        ...state.cart,
        {
          category: "OTHER",
          name: item.name,
          quantity: item.quantity ?? 1,
          stockQuantity: null,
          uid: nextUid(),
          unitPrice: item.unitPrice,
        },
      ];
      return { cart, cartTotal: computeTotal(cart) };
    });
  },

  updateQuantity: (index, quantity) => {
    set((state) => {
      const cart = [...state.cart];
      const line = cart[index];
      if (!line) {
        return state;
      }
      const max = line.stockQuantity ?? Number.MAX_SAFE_INTEGER;
      cart[index] = { ...line, quantity: Math.max(1, Math.min(quantity, max)) };
      return { cart, cartTotal: computeTotal(cart) };
    });
  },

  removeLine: (index) => {
    set((state) => {
      const cart = state.cart.filter((_, i) => i !== index);
      return { cart, cartTotal: computeTotal(cart) };
    });
  },

  clearCart: () => set({ cart: [], cartTotal: 0 }),

  checkout: async (payments) => {
    set({ error: null });
    const { cart, cartTotal } = useSalesStore.getState();
    if (cart.length === 0) {
      return Promise.reject(new Error("empty cart"));
    }
    const payload: CreateSaleInput = {
      items: cart.map((l) => ({
        ...(l.partId ? { partId: l.partId } : {}),
        category: l.category as CreateSaleInput["items"][number]["category"],
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
      payments,
    };
    if (
      Math.abs(payments.reduce((s, p) => s + p.amount, 0) - cartTotal) > 0.01
    ) {
      return Promise.reject(new Error("payment mismatch"));
    }
    set({ isCheckingOut: true });
    try {
      const res = await api.post("/sales", payload);
      const sale = res.data as Sale;
      set({ cart: [], cartTotal: 0, isCheckingOut: false });
      return sale;
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.create_sale"));
      set({ isCheckingOut: false, error: message });
      throw new Error(message);
    }
  },

  fetchSales: async (params) => {
    set({ isLoadingSales: true, error: null });
    try {
      const res = await api.get("/sales", { params });
      set({
        sales: res.data.sales,
        nextCursorSale: res.data.nextCursor ?? null,
        isLoadingSales: false,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, i18n.t("errors.fetch_sales"));
      set({ isLoadingSales: false, error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
