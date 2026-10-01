import { RTL_LANGUAGES } from "@shared/constants";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { setFormatLocale } from "@/lib/format";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";

const i18n = i18next.use(LanguageDetector).use(initReactI18next);

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
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    pt: { translation: pt },
  },
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
