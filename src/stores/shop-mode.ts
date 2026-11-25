import { create } from "zustand";
import api from "@/lib/api";

export type ShopMode = "repair_shop" | "ponto_only";

interface ShopModeState {
  error: boolean;
  fetchShopMode: () => Promise<void>;
  shopMode: ShopMode | null;
}

let inFlight: Promise<void> | null = null;

/**
 * Modo da instância disponível a qualquer utilizador autenticado. Não usa
 * /settings/shop porque essa rota é OWNER-only e o gate de navegação tem de
 * valer também para técnicos/front-desk.
 */
export const useShopModeStore = create<ShopModeState>((set) => ({
  error: false,
  shopMode: null,
  fetchShopMode: () => {
    inFlight ??= api
      .get("/ponto/mode")
      .then((res) => {
        set({
          error: false,
          shopMode:
            res.data?.shopMode === "ponto_only" ? "ponto_only" : "repair_shop",
        });
      })
      .catch(() => set({ error: true }))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
}));
