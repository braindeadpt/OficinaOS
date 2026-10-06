// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "@/components/ui/icon";

function svgFor(container: HTMLElement, name: string) {
  return container.querySelector(`svg[data-icon="${name}"]`);
}

describe("Icon", () => {
  it("renders the Lucide glyph mapped from the Material name", () => {
    const { container } = render(<Icon name="edit" />);
    const el = svgFor(container, "edit");
    expect(el).not.toBeNull();
    expect(el).toHaveClass("oos-icon");
    expect(el).toHaveClass("lucide-pencil");
  });

  it("is decorative by default and labelled when asked", () => {
    const { container } = render(<Icon name="check" />);
    expect(svgFor(container, "check")).toHaveAttribute("aria-hidden", "true");
    render(<Icon aria-label="Pronto" name="check_circle" />);
    expect(screen.getByRole("img", { name: "Pronto" })).toBeInTheDocument();
  });

  it("applies default size md (20px)", () => {
    const { container } = render(<Icon name="check" />);
    expect(svgFor(container, "check")).toHaveClass("text-[20px]");
  });

  it("applies size xs (14px)", () => {
    const { container } = render(<Icon name="close" size="xs" />);
    expect(svgFor(container, "close")).toHaveClass("text-[14px]");
  });

  it("lets a font-size class win over the default size", () => {
    const { container } = render(<Icon className="text-[18px]" name="add" />);
    const el = svgFor(container, "add");
    expect(el).toHaveClass("text-[18px]");
    expect(el).not.toHaveClass("text-[20px]");
  });

  it("applies custom color class", () => {
    const { container } = render(<Icon color="text-primary" name="error" />);
    expect(svgFor(container, "error")).toHaveClass("text-primary");
  });

  it("falls back to the Material font for unmapped names", () => {
    render(<Icon name="not_a_mapped_icon" />);
    expect(screen.getByText("not_a_mapped_icon")).toHaveClass(
      "material-symbols-outlined"
    );
  });
});
