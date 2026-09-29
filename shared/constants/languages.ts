export const LANGUAGES = ["pt", "en", "fr"] as const;

export type LanguageCode = (typeof LANGUAGES)[number];

export const RTL_LANGUAGES: readonly LanguageCode[] = [];
