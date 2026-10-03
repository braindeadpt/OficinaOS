-- Intake completeness: unlock code so the technician can test the device,
-- accessories checklist (avoids handover disputes), and a structured
-- functional checklist recorded at intake.
ALTER TABLE "jobs" ADD COLUMN "deviceUnlockCode" TEXT;
ALTER TABLE "jobs" ADD COLUMN "accessories" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "jobs" ADD COLUMN "intakeChecklist" JSONB;
