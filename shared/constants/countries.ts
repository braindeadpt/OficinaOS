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

export const COUNTRIES = [
  { code: "PT", label: "PT — Portugal" },
  { code: "FR", label: "FR — France" },
  { code: "US", label: "US — United States" },
  { code: "GB", label: "GB — United Kingdom" },
] as const;
