import { AuditAction } from "@generated/client";
import type { DbClient } from "../repositories/types.js";
import { findMany as userFindMany } from "../repositories/user.repository.js";

/**
 * Technician assignments are audited with user IDs; swap them for the
 * technician's name so the timeline never shows a raw ID. An ID whose user
 * no longer exists is left as is.
 */
export async function resolveTechnicianNames<
  T extends {
    action: string;
    fromValue?: string | null;
    toValue?: string | null;
  },
>(prisma: DbClient, entries: T[]): Promise<T[]> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.action !== AuditAction.TECHNICIAN_ASSIGNED) {
      continue;
    }
    for (const value of [entry.fromValue, entry.toValue]) {
      if (value && value !== "unassigned") {
        ids.add(value);
      }
    }
  }
  if (ids.size === 0) {
    return entries;
  }
  const users = await userFindMany(
    prisma,
    { id: { in: [...ids] } },
    { id: true, name: true, username: true },
    { id: "asc" },
    ids.size
  );
  const names = new Map(
    users.map((u) => [u.id, u.name?.trim() || u.username || u.id])
  );
  const label = (value: string | null | undefined) =>
    value ? (names.get(value) ?? value) : value;
  return entries.map((entry) =>
    entry.action === AuditAction.TECHNICIAN_ASSIGNED
      ? {
          ...entry,
          fromValue: label(entry.fromValue),
          toValue: label(entry.toValue),
        }
      : entry
  );
}
