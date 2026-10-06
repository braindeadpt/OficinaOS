// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import AddPartModal from "../add-part-modal";

describe("AddPartModal", () => {
  it("sends the opening stock and reorder level on create", () => {
    const onSubmit = vi.fn();
    render(<AddPartModal onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("add_part_modal.part_name"), {
      target: { value: "Ecrã iPhone 11" },
    });
    fireEvent.change(screen.getByLabelText("add_part_modal.category"), {
      target: { value: "SCREEN" },
    });
    fireEvent.change(screen.getByLabelText("add_part_modal.default_price"), {
      target: { value: "34.9" },
    });
    fireEvent.change(screen.getByLabelText("add_part_modal.initial_stock"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("add_part_modal.reorder_level"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "add_part_modal.add_part" })
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPrice: 34.9,
        reorderLevel: 2,
        stockQuantity: 5,
      })
    );
  });

  it("does not offer an opening stock field when editing", () => {
    render(
      <AddPartModal
        editingPart={
          {
            category: "SCREEN",
            defaultPrice: 10,
            id: "p1",
            isActive: true,
            listedOnline: false,
            name: "X",
            reorderLevel: 1,
            stockQuantity: 3,
            supplier: null,
          } as never
        }
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("add_part_modal.initial_stock")).toBeNull();
    expect(screen.getByLabelText("add_part_modal.reorder_level")).toHaveValue(
      "1"
    );
  });
});
