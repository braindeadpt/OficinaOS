// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusBadge } from "@/components/ui/status-badge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("StatusBadge", () => {
  it("renders the translated status label", () => {
    render(<StatusBadge status="IN_REPAIR" />);
    expect(screen.getByText("status.IN_REPAIR")).toBeInTheDocument();
  });

  it("applies IN_REPAIR color style", () => {
    render(<StatusBadge status="IN_REPAIR" />);
    const el = screen.getByText("status.IN_REPAIR");
    expect(el).toHaveClass("bg-status-in-repair-bg");
  });

  it("applies CANCELLED style with line-through", () => {
    render(<StatusBadge status="CANCELLED" />);
    const el = screen.getByText("status.CANCELLED");
    expect(el).toHaveClass("line-through");
  });
});
