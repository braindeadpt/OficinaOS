import type { JobStatusType } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { STATUS_TONES } from "@/lib/status-colors";

type BadgeSize = "sm" | "md" | "lg";

/**
 * Status chip (design-system.md §4.4): pill, icon + label, colours from the
 * status tokens. `sm` is the 22 px table version, `md` the 26 px default,
 * `lg` the 40 px header control on the job detail page.
 * Sentence case — the label is information, not a shout.
 */
const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "h-[22px] gap-1 px-2 text-xs",
  md: "h-[26px] gap-1.5 px-2.5 text-xs",
  lg: "h-10 gap-2 px-4 text-sm",
};

const GLYPH_CLASSES: Record<BadgeSize, string> = {
  sm: "size-[13px]",
  md: "size-[13px]",
  lg: "size-[18px]",
};

interface StatusBadgeProps {
  className?: string;
  size?: BadgeSize;
  status: JobStatusType;
}

export function StatusBadge({
  status,
  size = "md",
  className,
}: StatusBadgeProps) {
  const { t } = useTranslation();
  const tone = STATUS_TONES[status];
  const Glyph = tone.icon;

  return (
    <span
      className={[
        "inline-flex items-center whitespace-nowrap rounded-full font-semibold leading-none",
        SIZE_CLASSES[size],
        tone.container,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-status={status}
    >
      <Glyph
        aria-hidden="true"
        className={`${GLYPH_CLASSES[size]} shrink-0`}
        strokeWidth={2.25}
      />
      {t(`status.${status}`)}
    </span>
  );
}

/** Alias with the spec's name; same component. */
export const StatusChip = StatusBadge;

export default StatusBadge;
