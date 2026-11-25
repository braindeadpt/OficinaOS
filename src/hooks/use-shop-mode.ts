import { useEffect } from "react";
import { useShopModeStore } from "@/stores/shop-mode";

/**
 * Modo da instância, carregado uma vez por sessão. `null` significa ainda
 * desconhecido — os ecrãs que dependem dele devem esperar em vez de assumir
 * erradamente repair_shop.
 */
export function useShopMode() {
  const shopMode = useShopModeStore((s) => s.shopMode);
  const error = useShopModeStore((s) => s.error);
  const fetchShopMode = useShopModeStore((s) => s.fetchShopMode);

  useEffect(() => {
    if (!(shopMode || error)) {
      fetchShopMode().catch(() => undefined);
    }
  }, [shopMode, error, fetchShopMode]);

  return {
    isLoading: shopMode === null && !error,
    isPontoOnly: shopMode === "ponto_only",
    shopMode,
  };
}
