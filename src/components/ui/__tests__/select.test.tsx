// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select } from "@/components/ui/select";

describe("Select", () => {
  it("renders a select element", () => {
    render(
      <Select>
        <option value="EUR">EUR</option>
      </Select>
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("applies base select styles", () => {
    render(
      <Select>
        <option value="a">A</option>
      </Select>
    );
    const el = screen.getByRole("combobox");
    expect(el).toHaveClass("oos-field");
    expect(el).toHaveClass("oos-select");
  });
});
