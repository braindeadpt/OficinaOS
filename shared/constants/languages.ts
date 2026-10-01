export const LANGUAGES = ["pt", "en", "fr", "es"] as const;

export type LanguageCode = (typeof LANGUAGES)[number];

export const RTL_LANGUAGES: readonly LanguageCode[] = [];
