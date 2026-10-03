import type { ReactNode } from "react";

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
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-high">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-3xl text-on-surface-variant"
        >
          {icon}
        </span>
      </div>
      <p className="font-bold font-headline text-on-surface">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm font-body text-on-surface-variant text-sm">
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
