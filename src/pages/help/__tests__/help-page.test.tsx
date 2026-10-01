// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import HelpPage from "..";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

const BACK_LINK_RE = /help_back_to_app/;

describe("HelpPage", () => {
  it("renders every guide section", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    for (const key of [
      "help_address_title",
      "help_shop_title",
      "help_install_title",
      "help_remote_title",
      "help_problems_title",
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("shows the current origin so users know which address to open", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    // jsdom defaults to http://localhost:3000
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
    expect(screen.getByText("help_address_lan")).toBeInTheDocument();
  });

  it("links back into the app", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: BACK_LINK_RE })).toHaveAttribute(
      "href",
      "/"
    );
  });
});
