export const CURRENCIES = [
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "DZD", label: "DZD — Algerian Dinar (DA)" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
