// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import PreCheckPage from "..";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

describe("PreCheckPage embed mode", () => {
  it("renders no nav and no links inside the iframe widget", () => {
    const { container } = render(
      <MemoryRouter>
        <PreCheckPage embed />
      </MemoryRouter>
    );
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders the nav and language switcher outside embed mode", () => {
    const { container } = render(
      <MemoryRouter>
        <PreCheckPage />
      </MemoryRouter>
    );
    expect(container.querySelector("nav")).not.toBeNull();
  });
});
