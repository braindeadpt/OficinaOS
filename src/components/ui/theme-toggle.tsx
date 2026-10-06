import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { useThemeStore } from "@/stores/theme";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const LABEL_KEYS: Record<ThemePreference, string> = {
  system: "theme_system",
  light: "theme_light",
  dark: "theme_dark",
};

/**
 * Automático · Claro · Escuro (design-system.md §5.1). A native radio group
 * styled as a segmented control, so arrow keys and screen readers work
 * without extra wiring. The choice is per device, not per user.
 */
export function ThemeToggle({
  className,
  hideHint = false,
}: {
  className?: string;
  hideHint?: boolean;
}) {
  const { t } = useTranslation();
  const name = useId();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <fieldset className={className}>
      <legend className="mb-1.5 font-semibold text-on-surface text-sm">
        {t("appearance_title")}
      </legend>
      <div className="inline-flex rounded-lg border border-outline-variant bg-surface-container-low p-0.5">
        {THEME_PREFERENCES.map((value) => {
          const Glyph = ICONS[value];
          const checked = preference === value;
          return (
            <label
              className={`flex min-h-9 pointer-coarse:min-h-11 cursor-pointer items-center gap-1.5 rounded-md px-3 font-semibold text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                checked
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              key={value}
            >
              <input
                checked={checked}
                className="sr-only"
                name={name}
                onChange={() => setPreference(value)}
                type="radio"
                value={value}
              />
              <Glyph aria-hidden="true" className="size-4" />
              {t(LABEL_KEYS[value])}
            </label>
          );
        })}
      </div>
      {hideHint ? null : (
        <p className="mt-1.5 text-on-surface-variant text-xs">
          {t("appearance_desc")}
        </p>
      )}
    </fieldset>
  );
}
