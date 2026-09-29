import { RTL_LANGUAGES } from "@shared/constants";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";

const i18n = i18next.use(LanguageDetector).use(initReactI18next);

function applyDocumentDirection(lng: string) {
  if (typeof document === "undefined") {
    return;
  }
  const normalized = lng.split("-")[0];
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

if (typeof document !== "undefined") {
  applyDocumentDirection(i18n.language);
  i18n.on("languageChanged", applyDocumentDirection);
}

export default i18n;
