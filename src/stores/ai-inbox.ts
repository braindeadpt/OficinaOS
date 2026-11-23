import { create } from "zustand";
import api from "@/lib/api";

/**
 * Gate do módulo Pro "ai-inbox" para a UI: a sidebar esconde a entrada e
 * as páginas mostram o estado certo. /api/inbox/status devolve 403 sem
 * permissão inbox:view — também conta como desligado.
 */
interface AiInboxState {
  enabled: boolean | null;
  fetchStatus: () => Promise<void>;
}

export const useAiInboxStore = create<AiInboxState>((set) => ({
  enabled: null,
  fetchStatus: async () => {
    try {
      const res = await api.get("/inbox/status");
      set({ enabled: res.data?.enabled === true });
    } catch {
      set({ enabled: false });
    }
  },
}));
