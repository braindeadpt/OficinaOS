-- Intake no longer requires an estimated cost: many shops only price a
-- repair after diagnosis. NULL means "not yet quoted" (por orçamentar).
ALTER TABLE "jobs" ALTER COLUMN "estimatedCost" DROP NOT NULL;
