export function formatCurrency(
  value: number,
  currency = "EUR",
  locale = "pt-PT"
): string {
  return value.toLocaleString(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
