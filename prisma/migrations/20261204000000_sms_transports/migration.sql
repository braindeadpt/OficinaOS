-- Multi-transport SMS: "android" (free, sms-gate on the shop LAN),
-- "custom" (free, shop-configured HTTP provider — outbound only) and
-- "cloud" (Pro module "sms" — BulkSMS credentials relayed by
-- OficinaOS Cloud, inbound replies + delivery via cloud webhook).
ALTER TABLE "ShopSettings"
  ADD COLUMN "smsTransport" TEXT NOT NULL DEFAULT 'android',
  ADD COLUMN "smsCustomUrl" TEXT,
  ADD COLUMN "smsCustomMethod" TEXT NOT NULL DEFAULT 'POST',
  ADD COLUMN "smsCustomHeadersEncrypted" TEXT,
  ADD COLUMN "smsCustomBodyTemplate" TEXT,
  ADD COLUMN "smsCustomBodyFormat" TEXT NOT NULL DEFAULT 'json',
  ADD COLUMN "smsCustomSuccessText" TEXT,
  ADD COLUMN "smsBulksmsTokenId" TEXT,
  ADD COLUMN "smsBulksmsSecretEncrypted" TEXT,
  ADD COLUMN "smsCloudSender" TEXT,
  ADD COLUMN "smsCredentialsAtCloud" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smsCloudWebhookSecret" TEXT;
