-- Public base URL for customer-facing links (WhatsApp tracking links).
-- Optional: LAN-only shops simply leave it unset.
ALTER TABLE "shop_settings" ADD COLUMN "trackingBaseUrl" TEXT;
