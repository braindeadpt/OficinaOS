export const COUNTRY_DIAL_CODES: Record<string, string> = {
  DZ: "213",
  FR: "33",
  US: "1",
  GB: "44",
  DE: "49",
  TN: "216",
  MA: "212",
  PT: "351",
};

export const COUNTRIES = [
  { code: "DZ", label: "DZ — Algeria" },
  { code: "FR", label: "FR — France" },
  { code: "US", label: "US — United States" },
  { code: "GB", label: "GB — United Kingdom" },
  { code: "DE", label: "DE — Germany" },
  { code: "TN", label: "TN — Tunisia" },
  { code: "MA", label: "MA — Morocco" },
  { code: "PT", label: "PT — Portugal" },
] as const;
