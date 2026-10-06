/**
 * Min–max label for a market price stat. The cloud returns min/max as null
 * when fewer than 5 shops report the item; show "insufficient data" then
 * instead of a bogus "0,00 € – 0,00 €".
 */
export function formatPriceRange(
  stat: { maxCents: number | null; minCents: number | null },
  fmtCurrency: (value: number) => string,
  insufficientLabel: string
): string {
  if (stat.minCents == null || stat.maxCents == null) {
    return insufficientLabel;
  }
  return `${fmtCurrency(stat.minCents / 100)} – ${fmtCurrency(stat.maxCents / 100)}`;
}
