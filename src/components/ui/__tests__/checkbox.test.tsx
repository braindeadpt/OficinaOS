// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("renders an input[type=checkbox]", () => {
    render(<Checkbox id="test" />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("applies default checkbox styles", () => {
    render(<Checkbox id="test" />);
    const el = screen.getByRole("checkbox");
    expect(el).toHaveClass("h-5");
    expect(el).toHaveClass("w-5");
    expect(el).toHaveClass("rounded");
    expect(el).toHaveClass("accent-primary");
    // 44px touch target lives on the wrapper so the box itself stays 20px
    expect(el.parentElement).toHaveClass("size-11");
  });
});
