/**
 * Device categories (Device.category) — lowercase keys matching
 * DEVICE_ICONS so a category maps straight to an icon. Kept as a
 * string column (not a Prisma enum) so new types don't need a migration.
 */
export const DEVICE_CATEGORIES = [
  "phone",
  "tablet",
  "laptop",
  "desktop",
  "tv",
  "console",
  "gps",
  "watch",
  "other",
] as const;

export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

/**
 * Categories whose identifier field is a real IMEI — Luhn-checked.
 * Cellular tablets can carry an IMEI but Wi-Fi-only ones don't, so only
 * "phone" enforces it. Devices with a NULL category predate this field
 * and are all phones — treat them as phones too.
 */
export function isImeiCategory(category: string | null | undefined): boolean {
  return category === null || category === undefined || category === "phone";
}
