// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("offers Automático, Claro and Escuro as one radio group", () => {
    render(<ThemeToggle />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "theme_system" })).toBeChecked();
  });

  it("forces dark, persists it and can go back to the system", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "theme_dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: "theme_system" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
