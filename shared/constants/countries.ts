export const COUNTRY_DIAL_CODES: Record<string, string> = {
  PT: "351",
  FR: "33",
  GB: "44",
  US: "1",
};

/** Significant digits in a national number (trunk "0" excluded). */
export const NATIONAL_NUMBER_LENGTHS: Record<string, number> = {
  PT: 9,
  FR: 9,
  GB: 10,
  US: 10,
};

/**
 * Indicativo efetivamente usado ao formatar números da loja. Valores
 * legados/desconhecidos caem no fallback português histórico — o envio já
 * trata esses números como +351, por isso o reconhecimento inbound tem de
 * usar a mesma resolução.
 */
export function effectiveDialCode(
  countryCode: string | null | undefined
): string {
  return (countryCode ? COUNTRY_DIAL_CODES[countryCode] : undefined) ?? "351";
}

export const COUNTRIES = [
  { code: "PT", label: "PT — Portugal" },
  { code: "FR", label: "FR — France" },
  { code: "US", label: "US — United States" },
  { code: "GB", label: "GB — United Kingdom" },
] as const;
