-- Urgent flag for priority queue visibility, post-repair QC checklist
-- recorded on DONE, and estimatedDate widened to timestamptz so the
-- promised pickup time is stored, not just the day.
ALTER TABLE "jobs" ADD COLUMN "isUrgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN "qcChecklist" JSONB;
ALTER TABLE "jobs" ALTER COLUMN "estimatedDate" TYPE TIMESTAMPTZ;
