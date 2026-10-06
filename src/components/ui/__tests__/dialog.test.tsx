// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <Dialog onClose={() => undefined} open={false} title="Título" />
    );
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("labels the dialog with its title and description", () => {
    render(
      <Dialog
        description="Falta receber 129,90 €."
        onClose={() => undefined}
        open
        title="Entregar R-1042?"
      />
    );
    const dialog = screen.getByRole("dialog", { name: "Entregar R-1042?" });
    expect(dialog).toHaveAccessibleDescription("Falta receber 129,90 €.");
  });

  it("closes on Escape only when dismissible", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog dismissible={false} onClose={onClose} open title="Nota" />
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Dialog onClose={onClose} open title="Nota" />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but not on a click inside", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} open title="Nota">
        <p>Conteúdo</p>
      </Dialog>
    );
    fireEvent.click(screen.getByText("Conteúdo"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
