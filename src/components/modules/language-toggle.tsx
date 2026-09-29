import { LANGUAGES, type LanguageCode } from "@shared/constants";
import { useTranslation } from "react-i18next";

function getNextLang(current: string): LanguageCode {
  const idx = LANGUAGES.indexOf(current as LanguageCode);
  if (idx === -1 || idx === LANGUAGES.length - 1) {
    return LANGUAGES[0];
  }
  return LANGUAGES[idx + 1];
}

export default function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const normalizedLang = i18n.language.split("-")[0];

  return (
    <button
      aria-label={t("language_switch_to", {
        lang: getNextLang(normalizedLang).toUpperCase(),
      })}
      className="min-h-[40px] min-w-[40px] rounded-full bg-surface-container-high px-3 py-1.5 font-label font-semibold text-on-surface-variant text-xs uppercase tracking-wide transition-colors hover:bg-primary/10 hover:text-primary"
      onClick={() => {
        i18n.changeLanguage(getNextLang(normalizedLang));
      }}
      title={t("language_switch")}
      type="button"
    >
      {normalizedLang.toUpperCase()}
    </button>
  );
}
