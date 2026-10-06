// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
  });

  it("renders iconStart before input", () => {
    const { container } = render(
      <Input iconStart="person" placeholder="User" />
    );
    const icon = container.querySelector('svg[data-icon="person"]');
    expect(
      icon?.compareDocumentPosition(screen.getByPlaceholderText("User"))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders iconEnd after input", () => {
    const { container } = render(
      <Input iconEnd="visibility_off" placeholder="Pass" />
    );
    const icon = container.querySelector('svg[data-icon="visibility_off"]');
    expect(
      icon?.compareDocumentPosition(screen.getByPlaceholderText("Pass"))
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it("applies base input styles", () => {
    render(<Input placeholder="Test" />);
    const el = screen.getByPlaceholderText("Test");
    expect(el).toHaveClass("oos-field");
    expect(el).toHaveClass("h-10");
  });
});
