import { useTranslation } from "react-i18next";
import { useShopModeStore } from "@/stores/shop-mode";

/** Tradução do livro de ponto com variantes neutras para empresas quando
 *  a instância está em modo só ponto. As chaves `*_company` só existem
 *  para textos onde “loja/oficina” faria sentido numa oficina mas não
 *  num cliente standalone. */
export function usePontoT() {
  const { i18n, t } = useTranslation();
  const shopMode = useShopModeStore((s) => s.shopMode);

  return (key: string, options?: Record<string, unknown>) => {
    const companyKey = `${key}_company`;
    if (shopMode === "ponto_only" && i18n.exists(companyKey)) {
      return t(companyKey, options);
    }
    return t(key, options);
  };
}
