// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Label } from "@/components/ui/label";

describe("Label", () => {
  it("renders a label element", () => {
    render(<Label htmlFor="test">Shop Name</Label>);
    const el = screen.getByText("Shop Name");
    expect(el.tagName).toBe("LABEL");
    expect(el).toHaveAttribute("for", "test");
  });

  it("is sentence case, semibold, in the text colour", () => {
    render(<Label htmlFor="test2">Test</Label>);
    const el = screen.getByText("Test");
    expect(el).not.toHaveClass("uppercase");
    expect(el).toHaveClass("font-semibold");
    expect(el).toHaveClass("text-on-surface");
  });
});
