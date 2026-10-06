import { Icon } from "@/components/ui/icon";

type ButtonVariant =
  | "primary"
  | "primary-gradient"
  | "secondary"
  | "ghost"
  | "destructive"
  | "destructive-soft";
type ButtonSize = "sm" | "md" | "lg";

/**
 * Button variants from design-system.md §4.1. No gradients: the legacy
 * "primary-gradient" name renders as the flat primary. Hover/pressed only
 * change the fill; focus comes from the global :focus-visible ring.
 */
const PRIMARY =
  "bg-primary text-on-primary shadow-sm hover:bg-primary-hover active:bg-primary-hover";
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: PRIMARY,
  "primary-gradient": PRIMARY,
  secondary:
    "border border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container active:bg-surface-container-high",
  ghost:
    "bg-transparent text-link hover:bg-primary-soft active:bg-primary-soft",
  destructive:
    "bg-danger text-on-danger hover:brightness-[0.92] active:brightness-[0.88]",
  "destructive-soft":
    "bg-transparent text-danger hover:bg-danger-soft active:bg-danger-soft",
};

/** 32 / 40 / 48 px; every size grows to a 44 px+ target on touch screens. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 py-1.5 text-sm pointer-coarse:min-h-11",
  md: "min-h-10 px-3.5 py-2 text-base pointer-coarse:min-h-12",
  lg: "min-h-12 px-[18px] py-2.5 text-md",
};

const ICON_ONLY_CLASSES: Record<ButtonSize, string> = {
  sm: "size-8 pointer-coarse:size-11",
  md: "size-10 pointer-coarse:size-11",
  lg: "size-12",
};

const ICON_SIZE: Record<ButtonSize, "xs" | "sm" | "md"> = {
  sm: "xs",
  md: "xs",
  lg: "sm",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
  iconOnly?: boolean;
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconOnly = false,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-md font-sans font-semibold transition-[background-color,filter,color] duration-100 ease-standard disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        VARIANT_CLASSES[variant],
        iconOnly
          ? `shrink-0 p-0 ${ICON_ONLY_CLASSES[size]}`
          : SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      type={props.type ?? "button"}
      {...props}
    >
      {loading && (
        <Icon
          className="animate-spin"
          name="progress_activity"
          size={ICON_SIZE[size]}
        />
      )}
      {!loading && icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {!iconOnly && children}
      {iconOnly && !loading && !icon && children}
    </button>
  );
}
