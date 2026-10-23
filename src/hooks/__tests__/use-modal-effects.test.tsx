// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useModalEffects } from "../use-modal-effects";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Modal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(true, onClose, dialogRef);
  const [value, setValue] = useState("");
  return (
    <div ref={dialogRef}>
      <button type="button">close</button>
      <input
        aria-label="field"
        onChange={(e) => setValue(e.target.value)}
        value={value}
      />
    </div>
  );
}

describe("useModalEffects", () => {
  it("keeps focus on the input when onClose changes identity each render", () => {
    // Simulates consumers whose onClose is a useCallback that depends on form
    // state: every keystroke produced a new callback, which re-ran the effect
    // and re-focused the dialog's first focusable element (the close button).
    const { getByLabelText, rerender } = render(<Modal onClose={vi.fn()} />);

    const input = getByLabelText("field");
    input.focus();
    expect(document.activeElement).toBe(input);

    rerender(<Modal onClose={vi.fn()} />);
    rerender(<Modal onClose={vi.fn()} />);

    expect(document.activeElement).toBe(input);
  });

  it("calls the latest onClose on Escape", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Modal onClose={first} />);
    rerender(<Modal onClose={second} />);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
