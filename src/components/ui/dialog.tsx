import { type ReactNode, useEffect, useId, useRef } from "react";

type DialogSize = "sm" | "md" | "lg";

/** 400 (confirmation) · 560 (form) · 720 (detail), design-system.md §4.7. */
const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: "sm:max-w-[400px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[720px]",
};

interface DialogProps {
  /** Footer actions: secondary first, primary last (stacked, primary on top, on mobile). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  /**
   * When false, Escape and a backdrop click do nothing — for a form with
   * unsaved input. The explicit cancel action still closes.
   */
  dismissible?: boolean;
  onClose: () => void;
  open: boolean;
  size?: DialogSize;
  title: ReactNode;
}

/**
 * Modal dialog on the native <dialog> + showModal(): Escape, focus trap,
 * inert background and focus return come from the browser. Surface, radius
 * lg, shadow lg over the overlay token; below 640 px it becomes a full-width
 * bottom sheet. Enters with a fade + 8 px rise (duration-slow / ease-enter).
 */
export function Dialog({
  actions,
  children,
  className,
  description,
  dismissible = true,
  onClose,
  open,
  size = "md",
  title,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (open && !el.open) {
      // jsdom and very old browsers have no showModal(); fall back to [open].
      if (typeof el.showModal === "function") {
        el.showModal();
      } else {
        el.setAttribute("open", "");
      }
    } else if (!open && el.open) {
      if (typeof el.close === "function") {
        el.close();
      } else {
        el.removeAttribute("open");
      }
    }
  }, [open]);

  // Listeners go on the element directly: a click on the ::backdrop lands on
  // the <dialog> itself, and owning Escape keeps a non-dismissible dialog open
  // and stops the native close from running behind React's back.
  const dismissRef = useRef({ dismissible, onClose });
  dismissRef.current = { dismissible, onClose };
  useEffect(() => {
    const el = ref.current;
    if (!(open && el)) {
      return;
    }
    const onClick = (e: MouseEvent) => {
      if (e.target === el && dismissRef.current.dismissible) {
        dismissRef.current.onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (dismissRef.current.dismissible) {
          dismissRef.current.onClose();
        }
      }
    };
    const onCancel = (e: Event) => e.preventDefault();
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("cancel", onCancel);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={[
        "oos-dialog m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-xl bg-surface-container-lowest p-0 text-on-surface shadow-lg sm:m-auto sm:rounded-lg",
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
    >
      <div className="p-5 sm:p-6">
        <h2
          className="font-bold font-headline text-on-surface text-xl"
          id={titleId}
        >
          {title}
        </h2>
        {description ? (
          <p
            className="mt-1.5 text-base text-on-surface-variant"
            id={descriptionId}
          >
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {actions ? (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
