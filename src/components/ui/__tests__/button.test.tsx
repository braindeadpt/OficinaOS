// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders a button with children", () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole("button", { name: "Click me" })
    ).toBeInTheDocument();
  });

  it("applies primary variant styles by default", () => {
    render(<Button>Primary</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("bg-primary");
    expect(el).toHaveClass("text-on-primary");
  });

  it("applies secondary variant", () => {
    render(<Button variant="secondary">Sec</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("bg-surface-container-lowest");
    expect(el).toHaveClass("border-outline");
  });

  it("applies ghost variant", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("bg-transparent");
  });

  it("renders icon before children when icon prop provided", () => {
    render(<Button icon="add">Add</Button>);
    const button = screen.getByRole("button", { name: "Add" });
    const icon = button.querySelector('svg[data-icon="add"]');
    expect(icon).not.toBeNull();
    expect(icon?.nextSibling?.textContent).toBe("Add");
  });

  it("applies sm size", () => {
    render(<Button size="sm">Small</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("px-3");
    expect(el).toHaveClass("min-h-8");
  });

  it("marks a loading button busy and disabled", () => {
    render(<Button loading>A guardar…</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el).toBeDisabled();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
