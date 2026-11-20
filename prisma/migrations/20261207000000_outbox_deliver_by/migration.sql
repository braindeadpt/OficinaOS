-- Hard send deadline for time-sensitive outbox payloads. A signing link
-- queued for a 15-minute session must not be delivered by a retry that
-- lands after the session expired — the worker cancels entries past
-- deliverBy instead of sending a dead link.
ALTER TABLE "notification_outbox"
  ADD COLUMN "deliverBy" TIMESTAMPTZ;
