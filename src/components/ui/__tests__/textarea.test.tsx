// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText("Enter text...")).toBeInTheDocument();
  });

  it("applies base textarea styles", () => {
    render(<Textarea placeholder="Test" />);
    const el = screen.getByPlaceholderText("Test");
    expect(el).toHaveClass("oos-field");
    expect(el).toHaveClass("resize-none");
  });
});
