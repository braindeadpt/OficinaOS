import type { FastifyPluginAsync } from "fastify";

const SUPPORTED_LOCALES = new Set(["en", "es", "fr", "pt"]);

// PT is the product default — matches the client fallbackLng and receipt
// templates. An explicit Accept-Language still wins over the default.
function extractLocale(headers: Record<string, string | undefined>): string {
  const acceptLanguage = headers["accept-language"];
  if (!acceptLanguage) {
    return "pt";
  }
  const preferred = acceptLanguage
    .split(",")[0]
    ?.split("-")[0]
    ?.trim()
    ?.toLowerCase();
  if (preferred && SUPPORTED_LOCALES.has(preferred)) {
    return preferred;
  }
  return "pt";
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const localePlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("locale", "pt");
  app.addHook("onRequest", (request, _reply, done) => {
    request.locale = extractLocale(
      request.headers as Record<string, string | undefined>
    );
    done();
  });
};

declare module "fastify" {
  interface FastifyRequest {
    locale: string;
  }
}
