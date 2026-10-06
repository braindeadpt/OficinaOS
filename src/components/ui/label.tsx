interface LabelProps {
  children: React.ReactNode;
  className?: string;
  htmlFor: string;
}

/**
 * Field label (design-system.md §4.2): always visible above the control,
 * 14 px semibold, sentence case. Caps are reserved for text-caption.
 */
export function Label({ children, className, htmlFor }: LabelProps) {
  return (
    <label
      className={["font-semibold text-base text-on-surface", className]
        .filter(Boolean)
        .join(" ")}
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}
