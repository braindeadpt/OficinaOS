let currentLocale = "";

/**
 * Locale used for number/currency formatting, kept in sync with the active UI
 * language by the i18n bootstrap (which may carry a region, e.g. "pt-PT" or
 * "en-GB"), so money renders with the separators the user actually reads.
 * Falls back to the app's base language rather than hardcoding a market.
 */
export function setFormatLocale(locale: string): void {
  currentLocale = locale;
}

function activeLocale(): string {
  return currentLocale || "pt-PT";
}

export function formatCurrency(
  value: number,
  currency = "EUR",
  locale = activeLocale()
): string {
  return value.toLocaleString(locale, {
    style: "currency",
    currency,
    // Always two decimals: "34,90 €", never "34,9 €".
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
