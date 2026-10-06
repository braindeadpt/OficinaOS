// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from "@/lib/theme";

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to following the system", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("persists a forced theme and forgets it when back to system", () => {
    writeThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference()).toBe("dark");
    writeThemePreference("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("sets data-theme only when forced", () => {
    applyThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyThemePreference("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("resolves system against prefers-color-scheme", () => {
    mockSystemDark(true);
    expect(resolveTheme("system")).toBe("dark");
    mockSystemDark(false);
    expect(resolveTheme("system")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
});
