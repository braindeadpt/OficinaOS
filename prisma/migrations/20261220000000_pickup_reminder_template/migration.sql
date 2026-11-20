-- Pickup reminder Meta template name: the job_done_reminder nudge is
-- business-initiated and lands outside the customer's 24h WhatsApp window,
-- so Meta transports must send it as an APPROVED template. Null = freeform
-- fallback (Evolution only; Meta sends fail and surface in the outbox).
ALTER TABLE "shop_settings" ADD COLUMN "pickupReminderTemplate" TEXT;
