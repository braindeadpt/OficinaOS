import { create } from "zustand";
import {
  applyThemePreference,
  onSystemThemeChange,
  type ResolvedTheme,
  readThemePreference,
  resolveTheme,
  type ThemePreference,
  writeThemePreference,
} from "@/lib/theme";

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const initial = readThemePreference();

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initial,
  resolved: resolveTheme(initial),
  setPreference: (preference) => {
    writeThemePreference(preference);
    applyThemePreference(preference);
    set({ preference, resolved: resolveTheme(preference) });
  },
}));

// Keep `resolved` honest while following the system (used by the toaster).
onSystemThemeChange(() => {
  const { preference } = useThemeStore.getState();
  useThemeStore.setState({ resolved: resolveTheme(preference) });
});
