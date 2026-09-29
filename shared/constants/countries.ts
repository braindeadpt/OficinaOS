export const COUNTRY_DIAL_CODES: Record<string, string> = {
  PT: "351",
  FR: "33",
  GB: "44",
  US: "1",
};

export const COUNTRIES = [
  { code: "PT", label: "PT — Portugal" },
  { code: "FR", label: "FR — France" },
  { code: "US", label: "US — United States" },
  { code: "GB", label: "GB — United Kingdom" },
] as const;
