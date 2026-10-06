interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * Native checkbox: a 20px box centred in a 44px touch target. The target is
 * the wrapper, not the input — sizing the input itself to 44px makes Chromium
 * draw a giant box.
 */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <span className="inline-flex size-11 shrink-0 items-center justify-center">
      <input
        className={["h-5 w-5 cursor-pointer rounded accent-primary", className]
          .filter(Boolean)
          .join(" ")}
        type="checkbox"
        {...props}
      />
    </span>
  );
}
