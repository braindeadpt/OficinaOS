import type { FaultCategory } from "@generated/enums";
import type { PartCategoryType, RepairCategoryType } from "@shared/constants";

/**
 * How each domain category is presented: badge colour, bar colour, icon and
 * generated code prefix.
 *
 * These used to be four separate `Record<string, string>` maps, one per
 * screen, and they had already drifted. The repair category maps covered only
 * three of the four categories the server accepts, so a repair service saved
 * as OTHER rendered with no badge colour, the HARDWARE icon in the list and a
 * "HW" code prefix, and the filter pills and the create dialog offered no way
 * to pick it at all. Keying by the domain type makes a missing entry a
 * compile error rather than a silently wrong colour at runtime.
 */

/** Badge surface for a repair service category. */
export const REPAIR_CATEGORY_TONES: Record<RepairCategoryType, string> = {
  DIAGNOSTIC: "bg-primary-fixed text-on-primary-fixed",
  HARDWARE: "bg-secondary-container text-on-secondary-container",
  OTHER: "bg-surface-container-high text-on-surface-variant",
  SOFTWARE: "bg-tertiary-fixed text-on-tertiary-fixed",
};

/** Solid fill for the share bars, which sit behind their own text colour. */
export const REPAIR_CATEGORY_BAR_COLORS: Record<RepairCategoryType, string> = {
  DIAGNOSTIC: "bg-primary",
  HARDWARE: "bg-secondary",
  OTHER: "bg-surface-container-highest",
  SOFTWARE: "bg-tertiary",
};

export const REPAIR_CATEGORY_ICONS: Record<
  RepairCategoryType,
  { icon: string; iconBg: string; iconColor: string }
> = {
  DIAGNOSTIC: {
    icon: "troubleshoot",
    iconBg: "bg-tertiary-fixed",
    iconColor: "text-tertiary",
  },
  HARDWARE: {
    icon: "build",
    iconBg: "bg-primary-fixed",
    iconColor: "text-primary",
  },
  OTHER: {
    icon: "category",
    iconBg: "bg-surface-container-highest",
    iconColor: "text-on-surface-variant",
  },
  SOFTWARE: {
    icon: "terminal",
    iconBg: "bg-secondary-fixed",
    iconColor: "text-secondary",
  },
};

/** Prefix for the generated REP-xxx code shown in the catalogue. */
export const REPAIR_CATEGORY_PREFIXES: Record<RepairCategoryType, string> = {
  DIAGNOSTIC: "DG",
  HARDWARE: "HW",
  OTHER: "OT",
  SOFTWARE: "SW",
};

export const PART_CATEGORY_TONES: Record<PartCategoryType, string> = {
  BATTERY: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  BUTTON: "bg-secondary-container text-on-secondary-container",
  CAMERA: "bg-primary-fixed text-on-primary-fixed",
  CHARGING_PORT: "bg-secondary-fixed text-on-secondary-fixed-variant",
  HOUSING: "bg-surface-container-high text-on-surface-variant",
  MICROPHONE: "bg-secondary-container text-on-secondary-container",
  MOTHERBOARD: "bg-error-container text-on-error-container",
  OTHER: "bg-surface-container-high text-on-surface-variant",
  SCREEN: "bg-primary-fixed text-on-primary-fixed",
  SPEAKER: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
};

export const FAULT_TONES: Record<FaultCategory, string> = {
  DEFECTIVE_PART: "bg-tertiary",
  MISDIAGNOSIS: "bg-error",
  WORKMANSHIP: "bg-primary",
};
