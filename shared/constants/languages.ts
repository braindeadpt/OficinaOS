export const LANGUAGES = ["en", "fr", "ar", "pt"] as const;

export type LanguageCode = (typeof LANGUAGES)[number];

export const RTL_LANGUAGES: readonly LanguageCode[] = ["ar"];
