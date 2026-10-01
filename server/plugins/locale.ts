import type { FastifyPluginAsync } from "fastify";

const SUPPORTED_LOCALES = new Set(["en", "es", "fr", "pt"]);

function extractLocale(headers: Record<string, string | undefined>): string {
  const acceptLanguage = headers["accept-language"];
  if (!acceptLanguage) {
    return "en";
  }
  const preferred = acceptLanguage
    .split(",")[0]
    ?.split("-")[0]
    ?.trim()
    ?.toLowerCase();
  if (preferred && SUPPORTED_LOCALES.has(preferred)) {
    return preferred;
  }
  return "en";
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const localePlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("locale", "en");
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
