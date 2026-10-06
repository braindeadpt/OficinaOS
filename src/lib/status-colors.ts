import type { JobStatusType } from "@shared/constants";
import {
  CircleCheck,
  CircleX,
  Inbox,
  type LucideIcon,
  Package,
  PackageCheck,
  Pause,
  Undo2,
  Wrench,
} from "lucide-react";

/**
 * Single source of truth for job status colour and icon.
 *
 * Every surface that renders a status (chip, dot, list row) reads from this
 * one record per status, so a status can never appear in two different
 * colours in two places. The values are the «Parafuso» status tokens
 * (design-system.md §3.2, `--oos-status-<slug>-{bg|fg|dot}`), which carry
 * their own dark-mode variants, plus the Lucide icon that is part of the
 * status: colour is never the only signal (§1.4).
 *
 * `container` is the chip background + text pair. `dot` is the solid form,
 * for places where a chip does not fit (calendar, compressed kanban) — always
 * next to the text or in a tooltip.
 */
export interface StatusTone {
  container: string;
  dot: string;
  icon: LucideIcon;
  /** Material Symbols name of the same glyph, for screens still on <Icon>. */
  iconName: string;
}

export const STATUS_TONES: Record<JobStatusType, StatusTone> = {
  INTAKE: {
    container: "bg-status-intake-bg text-status-intake-fg",
    dot: "bg-status-intake-dot",
    icon: Inbox,
    iconName: "inbox",
  },
  WAITING_FOR_PARTS: {
    container:
      "bg-status-waiting-for-parts-bg text-status-waiting-for-parts-fg",
    dot: "bg-status-waiting-for-parts-dot",
    icon: Package,
    iconName: "inventory_2",
  },
  IN_REPAIR: {
    container: "bg-status-in-repair-bg text-status-in-repair-fg",
    dot: "bg-status-in-repair-dot",
    icon: Wrench,
    iconName: "build",
  },
  ON_HOLD: {
    container: "bg-status-on-hold-bg text-status-on-hold-fg",
    dot: "bg-status-on-hold-dot",
    icon: Pause,
    iconName: "pause_circle",
  },
  DONE: {
    container: "bg-status-done-bg text-status-done-fg",
    dot: "bg-status-done-dot",
    icon: CircleCheck,
    iconName: "check_circle",
  },
  DELIVERED: {
    container: "bg-status-delivered-bg text-status-delivered-fg",
    dot: "bg-status-delivered-dot",
    icon: PackageCheck,
    iconName: "outbox",
  },
  RETURNED: {
    container: "bg-status-returned-bg text-status-returned-fg",
    dot: "bg-status-returned-dot",
    icon: Undo2,
    iconName: "assignment_return",
  },
  CANCELLED: {
    container: "bg-status-cancelled-bg text-status-cancelled-fg line-through",
    dot: "bg-status-cancelled-dot",
    icon: CircleX,
    iconName: "cancel",
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

/** The Lucide icon that belongs to a status. */
export function statusIcon(status: JobStatusType): LucideIcon {
  return STATUS_TONES[status].icon;
}
