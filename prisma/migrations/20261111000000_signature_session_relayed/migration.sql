-- Marks sessions also published to the cloud relay: a pending relayed
-- session pulls fresh signature replies on each staff poll instead of
-- waiting for the ~2-minute entitlements sync.
ALTER TABLE "signature_sessions"
  ADD COLUMN IF NOT EXISTS "relayed" BOOLEAN NOT NULL DEFAULT false;
