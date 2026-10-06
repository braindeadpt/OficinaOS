import { type RefObject, useCallback, useEffect, useRef } from "react";

let scrollLockCount = 0;

// Backdrop buttons carry tabIndex={-1}; they must never take initial focus
// or be part of the Tab cycle.
const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map((sel) => `${sel}:not([tabindex="-1"])`)
  .join(", ");

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scrollLockCount = 0;
    document.body.style.overflow = "";
  });
}

export function useModalEffects(
  open: boolean,
  onClose: () => void,
  dialogRef?: RefObject<HTMLElement | null>,
  options?: { closeOnEscape?: boolean }
) {
  const previousFocus = useRef<HTMLElement | null>(null);
  // A consumer that needs a two-stage Escape (clear the filter first, close
  // second) turns this off and handles the key on its own element.
  const closeOnEscape = options?.closeOnEscape ?? true;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (closeOnEscape) {
          onClose();
        }
        return;
      }
      if (e.key === "Tab" && dialogRef?.current) {
        trapFocus(e, dialogRef.current);
      }
    },
    [closeOnEscape, onClose, dialogRef]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    scrollLockCount++;
    if (scrollLockCount === 1) {
      document.body.style.overflow = "hidden";
    }
    previousFocus.current = document.activeElement as HTMLElement;
    document.addEventListener("keydown", handleKeyDown);
    if (dialogRef?.current) {
      const first =
        dialogRef.current.querySelector<HTMLElement>("[autofocus]") ??
        dialogRef.current.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
      scrollLockCount--;
      if (scrollLockCount === 0) {
        document.body.style.overflow = "";
      }
    };
  }, [open, handleKeyDown, dialogRef]);
}

function trapFocus(e: KeyboardEvent, container: HTMLElement) {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE)
  );
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1) ?? focusable[0];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
