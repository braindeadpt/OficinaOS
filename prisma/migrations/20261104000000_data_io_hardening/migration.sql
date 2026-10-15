-- Data-IO hardening (PR A):
--   1. AuditAction: DATA_EXPORTED / DATA_IMPORTED — bulk exports and imports
--      are recorded with entity + row counts only (never row data / PII).
--   2. jobs.externalRef — legacy-system reference used to deduplicate
--      reimports of historical jobs.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DATA_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DATA_IMPORTED';

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "externalRef" VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_externalRef_key" ON "jobs" ("externalRef");
