import { Icon } from "@/components/ui/icon";

type ButtonVariant =
  | "primary"
  | "primary-gradient"
  | "secondary"
  | "ghost"
  | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-container active:scale-[0.98]",
  "primary-gradient":
    "bg-gradient-to-r from-primary to-primary-container text-on-primary hover:opacity-90 active:scale-[0.98]",
  secondary:
    "bg-surface-container-highest text-on-secondary-fixed-variant hover:bg-surface-container active:scale-[0.98]",
  ghost:
    "bg-transparent text-on-surface-variant hover:bg-surface-container-low active:scale-[0.98]",
  destructive: "bg-error text-on-error hover:opacity-90 active:scale-[0.98]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 py-2 text-xs",
  md: "min-h-11 px-5 py-2.5 text-sm",
  lg: "min-h-12 px-8 py-3 text-base",
};

const ICON_SIZE: Record<ButtonSize, "sm" | "md"> = {
  sm: "sm",
  md: "sm",
  lg: "md",
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
      className={[
        "flex items-center justify-center gap-2 rounded-xl font-bold font-headline transition-all disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_CLASSES[variant],
        iconOnly ? "aspect-square min-h-11 min-w-11 p-0" : SIZE_CLASSES[size],
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
