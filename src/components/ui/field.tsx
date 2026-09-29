import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import { Label } from "@/components/ui/label";

/**
 * Props every control accepts so Field can wire the label, hint and error
 * together. All three are valid DOM attributes, so this works with the Input,
 * Select and Textarea primitives as well as a hand-rolled element.
 */
export interface FieldControlProps {
  "aria-describedby"?: string;
  "aria-invalid"?: true | undefined;
  id?: string;
}

interface FieldProps {
  /** The single control this field labels. */
  children: ReactElement<FieldControlProps>;
  className?: string;
  /** Rendered inside the field, over the control — a select chevron, a password toggle. */
  endAdornment?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  /** Lay the label beside the control, for checkbox and switch rows. */
  horizontal?: boolean;
  /** Overrides the generated control id. A child-provided id also wins. */
  id?: string;
  label: ReactNode;
  required?: boolean;
}

/**
 * The single way to lay out a form control: label, control, hint and error.
 *
 * Field owns the id and the `aria-describedby` / `aria-invalid` wiring, so a
 * field cannot ship with a label pointing at nothing or an error no screen
 * reader ever announces. This replaces the hand-rolled label + input + error
 * block repeated across the forms.
 */
export function Field({
  children,
  className,
  endAdornment,
  error,
  hint,
  horizontal = false,
  id,
  label,
  required = false,
}: FieldProps) {
  const baseId = useId();
  const controlId = id ?? children.props.id ?? baseId;
  // The hint is not rendered while an error is shown, so it must not stay in
  // aria-describedby either — that would leave a dangling reference.
  const hintId = hint && !error ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;

  const describedBy =
    [children.props["aria-describedby"], hintId, errorId]
      .filter(Boolean)
      .join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        id: controlId,
      })
    : children;

  const messages = (
    <>
      {hint && !error && (
        <p
          className="ms-1 mt-1 font-label text-on-surface-variant text-xs"
          id={hintId}
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          className="mt-1 flex items-start gap-1 font-label font-medium text-error text-xs"
          id={errorId}
          role="alert"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined shrink-0 text-[14px]"
          >
            error
          </span>
          {error}
        </p>
      )}
    </>
  );

  if (horizontal) {
    return (
      <div
        className={["flex min-h-11 items-center gap-3", className]
          .filter(Boolean)
          .join(" ")}
      >
        {control}
        <div className="min-w-0 flex-1">
          <Label className="cursor-pointer" htmlFor={controlId}>
            {label}
            {required && (
              <span aria-hidden="true" className="ms-1 text-error">
                *
              </span>
            )}
          </Label>
          {messages}
        </div>
      </div>
    );
  }

  return (
    <div
      className={[endAdornment ? "relative" : null, className]
        .filter(Boolean)
        .join(" ")}
    >
      <Label className="ms-1 mb-2 block" htmlFor={controlId}>
        {label}
        {required && (
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        )}
      </Label>
      {control}
      {endAdornment}
      {messages}
    </div>
  );
}
