import type { JobStatusType } from "@shared/constants";

/**
 * Single source of truth for job status colour.
 *
 * Every surface that renders a status (badge, chip, dot) reads from this one
 * record per status, so a status can never appear in two different colours in
 * two places. This replaced four separate maps that had drifted apart: On Hold
 * was a red dot but a grey badge, and Returned was exactly the other way round.
 *
 * `container` is the surface + on-surface pair from DESIGN.md §5 "Chips".
 * `dot` is the solid form of that same colour family — it cannot be derived
 * from the container, because the neutral containers (On Hold, Delivered,
 * Cancelled) are deliberately the same surface while meaning different things,
 * and a dot is the only status signal in the dashboard lists.
 */
export interface StatusTone {
  container: string;
  dot: string;
}

export const STATUS_TONES: Record<JobStatusType, StatusTone> = {
  INTAKE: {
    container: "bg-secondary-container text-on-secondary-container",
    dot: "bg-secondary",
  },
  WAITING_FOR_PARTS: {
    container: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
    dot: "bg-tertiary",
  },
  IN_REPAIR: {
    container: "bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  ON_HOLD: {
    container: "bg-surface-container-high text-on-surface-variant",
    dot: "bg-outline-variant",
  },
  DONE: {
    container: "bg-primary-fixed text-on-primary-fixed-variant",
    dot: "bg-primary",
  },
  DELIVERED: {
    container: "bg-surface-container text-on-surface-variant",
    dot: "bg-on-secondary-container",
  },
  RETURNED: {
    container: "bg-error-container text-on-error-container",
    dot: "bg-error",
  },
  CANCELLED: {
    container: "bg-surface-container-high text-on-surface-variant line-through",
    dot: "bg-outline",
  },
};

/** Surface + text classes for a status badge or chip. */
export function statusContainerClass(status: JobStatusType): string {
  return STATUS_TONES[status].container;
}

/** Solid background class for a status dot. */
export function statusDotClass(status: JobStatusType): string {
  return STATUS_TONES[status].dot;
}
