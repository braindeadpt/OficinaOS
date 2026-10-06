import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

interface EmptyStateProps {
  action?: ReactNode;
  description?: string;
  icon: string;
  title: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-container">
        <Icon className="text-on-surface-variant" name={icon} size="lg" />
      </div>
      <p className="font-semibold text-lg text-on-surface">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-base text-on-surface-variant">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>
      )}
    </div>
  );
}

export default EmptyState;
