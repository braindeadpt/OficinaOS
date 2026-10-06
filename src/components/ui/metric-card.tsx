import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { useCountUp } from "@/hooks/use-count-up";

interface MetricCardProps {
  children?: ReactNode;
  className?: string;
  detail: string;
  icon: string;
  iconColor?: string;
  label: string;
  labelTooltip?: string;
  onClick?: () => void;
  unit?: string;
  value: string;
}

function AnimatedValue({ value }: { value: string }) {
  const numeric = value.trim() === "" ? Number.NaN : Number(value);
  const animated = useCountUp(Number.isFinite(numeric) ? numeric : 0);
  if (!Number.isFinite(numeric)) {
    return <>{value}</>;
  }
  const decimals = value.includes(".") ? value.split(".")[1].length : 0;
  return <>{animated.toFixed(decimals)}</>;
}

export function MetricCard({
  label,
  value,
  unit,
  detail,
  icon,
  iconColor,
  labelTooltip,
  children,
  className,
  onClick,
}: MetricCardProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p
          className="font-semibold text-on-surface-variant text-xs"
          title={labelTooltip}
        >
          {label}
        </p>
        <Icon
          className={`mt-0.5 shrink-0 ${iconColor ?? "text-on-surface-variant"}`}
          name={icon}
          size="md"
        />
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-extrabold font-headline text-3xl text-on-surface tabular-nums">
          <AnimatedValue value={value} />
        </span>
        {unit && (
          <span className="font-medium text-on-surface-variant text-sm">
            {unit}
          </span>
        )}
      </div>
      <p className="mt-1 text-on-surface-variant text-xs">{detail}</p>
      {children && <div className="mt-3">{children}</div>}
    </>
  );

  const sharedClass = `relative overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest p-5 shadow-sm transition-colors ${
    onClick ? "cursor-pointer hover:bg-surface-container w-full text-start" : ""
  } ${className ?? ""}`;

  if (onClick) {
    return (
      <button className={sharedClass} onClick={onClick} type="button">
        {inner}
      </button>
    );
  }

  return <div className={sharedClass}>{inner}</div>;
}

export default MetricCard;
