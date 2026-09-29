export const CURRENCIES = [
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
