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

/**
 * Symbol for a currency code in the active locale ("€" for EUR in pt-PT).
 * Falls back to the ISO code when Intl has no symbol for it.
 */
export function currencySymbol(
  currency = "EUR",
  locale = activeLocale()
): string {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  );
}

/**
 * Locale-aware plain number ("1 234,56" in pt-PT, "1,234.56" in en-US).
 * toFixed() always emits "." — use this anywhere a number is shown to users.
 */
export function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString(activeLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
