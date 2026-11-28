/**
 * Língua documental derivada do país configurado da loja — usada nas
 * superfícies ao cliente sem browser próprio (WhatsApp, SMS, email, bot),
 * onde não há Accept-Language a indicar a língua do cliente.
 *
 * Lojas em PT mantêm pt (comportamento histórico inalterado); países sem
 * correspondência caem em en, a língua franca internacional.
 */
const COUNTRY_DOCUMENT_LOCALE: Record<string, string> = {
  PT: "pt",
  BR: "pt",
  ES: "es",
  FR: "fr",
};

const SUPPORTED = new Set(["pt", "en", "es", "fr"]);

export function documentLocaleForCountry(
  countryCode: string | null | undefined
): string {
  const cc = (countryCode ?? "PT").trim().toUpperCase();
  const lang = COUNTRY_DOCUMENT_LOCALE[cc] ?? "en";
  return SUPPORTED.has(lang) ? lang : "en";
}

/** Versão tolerante: aceita já um locale de língua e normaliza-o. */
export function normalizeDocumentLocale(
  locale: string | null | undefined
): string {
  const lang = (locale ?? "pt").split("-")[0].trim().toLowerCase();
  return SUPPORTED.has(lang) ? lang : "pt";
}

/** Resolve a língua de documentos impressos/gerados: escolha explícita
 * válida primeiro, depois o país da loja, nunca o Accept-Language do
 * browser que por acaso abriu a página de impressão. */
export function resolveDocumentLocale(
  explicitLocale: string | null | undefined,
  countryCode: string | null | undefined
): string {
  const explicit = (explicitLocale ?? "").split("-")[0].trim().toLowerCase();
  if (SUPPORTED.has(explicit)) {
    return explicit;
  }
  return documentLocaleForCountry(countryCode);
}
