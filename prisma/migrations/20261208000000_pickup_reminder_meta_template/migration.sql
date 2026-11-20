-- Pickup reminder Meta template: outbox entries can carry an approved
-- Meta template payload for official WhatsApp transports (local Graph /
-- cloud relay), and shops configure the template name per install.
ALTER TABLE "notification_outbox" ADD COLUMN "metaTemplate" JSONB;

ALTER TABLE "shop_settings" ADD COLUMN "pickupReminderTemplate" TEXT;
