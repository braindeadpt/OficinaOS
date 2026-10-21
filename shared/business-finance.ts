/** EUR amounts use integer cents; VAT rates use hundredths of a percent. */
export function cents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function money(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function net(gross: bigint, rate: string): bigint {
  const divisor = 10000n + cents(rate);
  return (gross * 10000n + divisor / 2n) / divisor;
}
export function orderMargin(input: {
  costGross: string;
  quoteGross: string;
  costVatRate: string;
  saleVatRate: string;
  recoverInputVat: boolean;
}) {
  const costGross = cents(input.costGross);
  const quoteGross = cents(input.quoteGross);
  const costNet = input.recoverInputVat
    ? net(costGross, input.costVatRate)
    : costGross;
  const revenueNet = net(quoteGross, input.saleVatRate);
  const profit = revenueNet - costNet;
  return {
    costNet: money(costNet),
    revenueNet: money(revenueNet),
    profitAfterVat: money(profit),
    vatBalance: money(quoteGross - revenueNet - (costGross - costNet)),
    marginPercent:
      revenueNet === 0n ? null : Number((profit * 10000n) / revenueNet) / 100,
  };
}
export function commissionGross(
  basis: string,
  rate: string,
  vat: string
): string {
  const commission = (cents(basis) * cents(rate) + 5000n) / 10000n;
  return money((commission * (10000n + cents(vat)) + 5000n) / 10000n);
}
