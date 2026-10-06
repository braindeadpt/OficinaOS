import type { Ref } from "react";
import { Icon } from "@/components/ui/icon";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  iconEnd?: string;
  iconStart?: string;
  ref?: Ref<HTMLInputElement>;
}

export const Input = ({
  iconStart,
  iconEnd,
  className,
  ref,
  ...props
}: InputProps) => {
  const hasIconStart = !!iconStart;
  const hasIconEnd = !!iconEnd;

  const inputClasses = [
    "oos-field h-10 w-full px-3 pointer-coarse:h-12",
    hasIconStart && "ps-10",
    hasIconEnd && "pe-10",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="group relative">
      {iconStart && (
        <Icon
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary"
          name={iconStart}
          size="md"
        />
      )}
      <input className={inputClasses} ref={ref} {...props} />
      {iconEnd && (
        <Icon
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          name={iconEnd}
          size="md"
        />
      )}
    </div>
  );
};

Input.displayName = "Input";
