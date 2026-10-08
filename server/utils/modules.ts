/**
 * Cached Pro entitlements live on ShopSettings.cloudEntitlements (polled
 * from the cloud every 2 min). A local feature is active only while the
 * module id is in that list — expired/revoked grants disappear on the
 * next sync and the feature stops without touching its own toggle.
 */
export function isModuleEnabled(
  row: { cloudEntitlements?: unknown } | null | undefined,
  module: string
): boolean {
  const modules = Array.isArray(row?.cloudEntitlements)
    ? (row.cloudEntitlements as string[])
    : [];
  return modules.includes(module);
}
