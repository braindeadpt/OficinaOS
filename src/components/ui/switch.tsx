interface SwitchProps {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  onChange: (checked: boolean) => void;
  title?: string;
}

export function Switch({
  ariaLabel,
  ariaLabelledBy,
  checked,
  className,
  disabled = false,
  id,
  onChange,
  title,
}: SwitchProps) {
  return (
    <div className="flex min-h-[44px] min-w-[44px] items-center justify-center">
      <button
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={[
          "relative h-6 w-11 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-surface-container-highest",
          disabled && "cursor-not-allowed opacity-50",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        id={id}
        onClick={() => {
          if (!disabled) {
            onChange(!checked);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === " ") {
            e.preventDefault();
          }
        }}
        role="switch"
        title={title}
        type="button"
      >
        <span
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full shadow-sm transition-all",
            checked
              ? "start-[22px] bg-on-primary"
              : "start-0.5 bg-on-surface-variant",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </button>
    </div>
  );
}
