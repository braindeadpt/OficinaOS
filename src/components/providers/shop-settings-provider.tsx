import type { ReactNode } from "react";
import { useEffect } from "react";
import { ShopCurrencyProvider } from "@/hooks/use-format-currency";
import { useSettingsStore } from "@/stores/settings";

const DEFAULT_CURRENCY = "EUR";

/**
 * In-flight guard so every consumer mounting at once shares one request.
 * Cleared on settle so a failed load can be retried on the next mount rather
 * than being remembered as "already tried".
 */
let inFlight: Promise<void> | null = null;

/**
 * Fetches the shop settings once and publishes the currency.
 *
 * Nothing outside the settings screen used to fetch them, so `shopSettings`
 * stayed null for the whole session and every screen read the EUR default.
 * Mounted at the authenticated layout root so the currency is known before
 * the first money is rendered.
 */
export function ShopSettingsProvider({ children }: { children: ReactNode }) {
  const shopSettings = useSettingsStore((s) => s.shopSettings);
  const fetchShopSettings = useSettingsStore((s) => s.fetchShopSettings);

  useEffect(() => {
    if (shopSettings) {
      return;
    }
    if (!inFlight) {
      // The store already swallows and stores its own error; the extra catch
      // keeps a future rejection from surfacing as an unhandled rejection.
      inFlight = fetchShopSettings()
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
        });
    }
  }, [shopSettings, fetchShopSettings]);

  return (
    <ShopCurrencyProvider currency={shopSettings?.currency ?? DEFAULT_CURRENCY}>
      {children}
    </ShopCurrencyProvider>
  );
}
