import { create } from "zustand";
import api from "@/lib/api";

/**
 * Gate do módulo Pro "ponto" para a UI: a sidebar/bottom-nav escondem a
 * entrada e a página mostra o estado certo. /api/ponto/status devolve
 * {enabled} — sem permissão também conta como desligado (fetch falha →
 * enabled:false).
 */
interface PontoState {
  enabled: boolean | null;
  fetchStatus: () => Promise<void>;
}

export const usePontoStore = create<PontoState>((set) => ({
  enabled: null,
  fetchStatus: async () => {
    try {
      const res = await api.get("/ponto/status");
      set({ enabled: res.data?.enabled === true });
    } catch {
      set({ enabled: false });
    }
  },
}));
