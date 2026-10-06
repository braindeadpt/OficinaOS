import { RTL_LANGUAGES } from "@shared/constants";
import type { BackendModule } from "i18next";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { setFormatLocale } from "@/lib/format";
import pt from "./locales/pt.json";

// Non-default locales load on demand (~130KB each): the backend module below
// is invoked by i18next whenever a language without a bundled resource is
// requested — on startup for non-PT users, and on every language switch.
const loaders = {
  en: () => import("./locales/en.json"),
  es: () => import("./locales/es.json"),
  fr: () => import("./locales/fr.json"),
};

const lazyBackend: BackendModule = {
  type: "backend",
  init() {
    // no-op — i18next only calls backend.read() for languages missing a
    // bundled resource (partialBundledLanguages).
  },
  read(language, _namespace, callback) {
    const loader = loaders[language.split("-")[0] as keyof typeof loaders];
    if (!loader) {
      callback(new Error(`No locale bundle for "${language}"`), null);
      return;
    }
    loader().then(
      (mod) => callback(null, mod.default),
      (err) => callback(err, null)
    );
  },
};

const i18n = i18next
  .use(lazyBackend)
  .use(LanguageDetector)
  .use(initReactI18next);

function applyLanguage(lng: string) {
  const normalized = lng.split("-")[0];
  // Number/currency formatting follows the UI language, region included.
  setFormatLocale(lng);
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dir = RTL_LANGUAGES.includes(
    normalized as (typeof RTL_LANGUAGES)[number]
  )
    ? "rtl"
    : "ltr";
  document.documentElement.lang = normalized;
}

i18n.init({
  // pt ships in the bundle — it's the fallback and must render instantly.
  resources: { pt: { translation: pt } },
  partialBundledLanguages: true,
  fallbackLng: "pt",
  detection: {
    order: ["localStorage", "navigator"],
    caches: ["localStorage"],
    lookupLocalStorage: "i18nextLng",
  },
  interpolation: { escapeValue: false },
});

// applyLanguage guards its own DOM writes, so the format locale is also set in
// non-browser contexts.
applyLanguage(i18n.language);
if (typeof document !== "undefined") {
  i18n.on("languageChanged", applyLanguage);
}

export default i18n;
