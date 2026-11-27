import { createContext, type ReactNode, use, useCallback } from "react";
import { currencySymbol, formatCurrency } from "@/lib/format";

/**
 * EUR until ShopSettingsProvider learns otherwise, so a component rendered
 * outside the authenticated layout (a test, an isolated render) still shows
 * money instead of throwing.
 */
const DEFAULT_CURRENCY = "EUR";

const ShopCurrencyContext = createContext<string>(DEFAULT_CURRENCY);

export function ShopCurrencyProvider({
  children,
  currency,
}: {
  children: ReactNode;
  currency: string;
}) {
  return <ShopCurrencyContext value={currency}>{children}</ShopCurrencyContext>;
}

/**
 * Money formatter bound to the shop's currency and the active language.
 *
 * Prefer this over calling `formatCurrency` directly, whose currency defaults
 * to EUR: 13 screens had been calling it with no currency and silently showed
 * euros in shops configured for USD or GBP.
 *
 * Depends only on context, not on the settings store, so components using it
 * can be rendered in tests without pulling in the i18n bootstrap.
 */
export function useFormatCurrency(): (value: number) => string {
  const currency = use(ShopCurrencyContext);
  return useCallback(
    (value: number) => formatCurrency(value, currency),
    [currency]
  );
}

/**
 * Símbolo da moeda da loja para etiquetas de campos monetários — o formulário
 * de intake mostra o que o cliente vai assinar, e o selo regista essa mesma
 * moeda; hardcoded «EUR» mentia em lojas noutra moeda.
 */
export function useCurrencySymbol(): string {
  const currency = use(ShopCurrencyContext);
  return currencySymbol(currency);
}
