-- Pickup reminder scheduler: dedupe/claim column mirroring
-- lastOverdueAlertAt. Jobs sitting DONE for days get a customer nudge at
-- most once per reminder window — the atomic updateMany on this column is
-- what prevents two overlapping ticks from double-sending.
ALTER TABLE "jobs" ADD COLUMN "lastPickupReminderAt" TIMESTAMPTZ;
