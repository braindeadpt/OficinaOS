import { z } from "zod";

/**
 * IDs in OficinaOS are opaque strings: Prisma generates cuids for seeded
 * records, better-auth generates 32-character random IDs for users and the
 * demo seed uses readable `demo-*` identifiers. Validating the shape as a
 * cuid rejected every better-auth user and every demo record, so IDs are
 * bounded here and their existence/ownership is checked by the services.
 */
export const OPAQUE_ID_MAX = 64;

// Every real ID (cuid, better-auth, uuid, demo-*) is URL-safe. Rejecting
// anything else keeps IDs safe to use in paths and logs (defence in depth:
// job photos build a directory from the job id).
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]+$/;

export const opaqueIdSchema = z
  .string()
  .trim()
  .min(1, { error: "validations.invalid_id" })
  .max(OPAQUE_ID_MAX, { error: "validations.invalid_id" })
  .regex(OPAQUE_ID_RE, { error: "validations.invalid_id" });
