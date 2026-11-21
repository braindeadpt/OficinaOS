/**
 * Cached Pro entitlements live on ShopSettings.cloudEntitlements (polled
 * from the cloud every 2 min). A local feature is active only while the
 * module id is in that list — expired/revoked grants disappear on the
 * next sync and the feature stops without touching its own toggle.
 *
 * The cache is a hint with a 24h validity: enforcement modules that call
 * straight to a third-party API (invoicing, remarketing via a legacy
 * local token) must not run forever on a stale list, so a row whose
 * last sync is missing or older than HINT_TTL_MS counts as no modules.
 */
export const HINT_TTL_MS = 24 * 3600 * 1000;

export function isModuleEnabled(
  row:
    | {
        cloudEntitlements?: unknown;
        cloudSyncedAt?: Date | null;
      }
    | null
    | undefined,
  module: string
): boolean {
  const fresh =
    row?.cloudSyncedAt != null &&
    Date.now() - row.cloudSyncedAt.getTime() < HINT_TTL_MS;
  if (!fresh) {
    return false;
  }
  const modules = Array.isArray(row?.cloudEntitlements)
    ? (row.cloudEntitlements as string[])
    : [];
  return modules.includes(module);
}
