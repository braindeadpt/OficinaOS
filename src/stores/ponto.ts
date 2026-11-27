import { create } from "zustand";
import api from "@/lib/api";

/**
 * Gate do módulo Pro "ponto" para a UI: a sidebar/bottom-nav escondem a
 * entrada e a página mostra o estado certo. /api/ponto/status devolve
 * {enabled, hasRecords, tz} — sem permissão também conta como desligado
 * (fetch falha → enabled:false). `tz` é o fuso efetivo da loja já
 * resolvido no servidor (ShopSettings.timezone com fallback env TZ): as
 * horas do painel são formatadas nele, nunca no fuso do dispositivo.
 * `hasRecords` mantém a exportação ACT alcançável depois de o entitlement
 * terminar — a lei exige 5 anos de acesso aos registos.
 */
interface PontoState {
  enabled: boolean | null;
  fetchStatus: () => Promise<void>;
  hasRecords: boolean | null;
  photoCleanupWarnings: string[];
  tz: string | null;
}

export const usePontoStore = create<PontoState>((set) => ({
  enabled: null,
  photoCleanupWarnings: [],
  hasRecords: null,
  tz: null,
  fetchStatus: async () => {
    try {
      const res = await api.get("/ponto/status");
      set({
        enabled: res.data?.enabled === true,
        photoCleanupWarnings: Array.isArray(res.data?.photoCleanupWarnings)
          ? res.data.photoCleanupWarnings
          : [],
        hasRecords: res.data?.hasRecords === true,
        tz: typeof res.data?.tz === "string" ? res.data.tz : null,
      });
    } catch {
      set({ enabled: false });
    }
  },
}));
