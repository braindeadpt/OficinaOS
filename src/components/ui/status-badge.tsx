import type { JobStatusType } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { statusContainerClass } from "@/lib/status-colors";

type BadgeSize = "sm" | "md";

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-xs",
};

const DEFAULT_SIZE_CLASSES = "px-2.5 py-0.5 font-extrabold text-xs";

interface StatusBadgeProps {
  size?: BadgeSize;
  status: JobStatusType;
}

export function StatusBadge({ status, size }: StatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <span
      className={[
        "inline-flex items-center whitespace-nowrap rounded-full uppercase tracking-wider",
        size ? SIZE_CLASSES[size] : DEFAULT_SIZE_CLASSES,
        statusContainerClass(status),
      ].join(" ")}
    >
      {t(`status.${status}`)}
    </span>
  );
}

export default StatusBadge;
