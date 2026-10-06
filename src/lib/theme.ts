/**
 * Appearance preference (design-system.md §5.1): follow the system by
 * default, or force light/dark. Stored per device in localStorage and applied
 * as data-theme on <html>; tokens.css does the rest. public/theme-init.js
 * applies the same key before the first paint, so keep THEME_STORAGE_KEY in
 * sync with it.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "oos-theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

export function readThemePreference(): ThemePreference {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
}

export function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.(DARK_QUERY).matches ?? false;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

/** Forced themes set data-theme; "system" removes it so the media query wins. */
export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement | undefined = globalThis.document?.documentElement
): void {
  if (!root) {
    return;
  }
  if (preference === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preference;
  }
}

/** Calls back when the OS switches between light and dark. */
export function onSystemThemeChange(callback: () => void): () => void {
  const mql = globalThis.matchMedia?.(DARK_QUERY);
  if (!mql) {
    return () => undefined;
  }
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
