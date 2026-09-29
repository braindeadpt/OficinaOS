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
    "w-full rounded-xl border-none bg-surface-container-highest px-4 py-3.5 text-sm transition-all focus:bg-surface-container-lowest",
    hasIconStart && "ps-12",
    hasIconEnd && "pe-12",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="group relative">
      {iconStart && (
        <Icon
          className="absolute start-4 top-1/2 -translate-y-1/2 text-outline transition-colors group-focus-within:text-primary"
          name={iconStart}
          size="sm"
        />
      )}
      <input className={inputClasses} ref={ref} {...props} />
      {iconEnd && (
        <Icon
          className="absolute end-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
          name={iconEnd}
          size="sm"
        />
      )}
    </div>
  );
};

Input.displayName = "Input";
