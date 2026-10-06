-- SMS channel (Pro module "sms"): NotifyChannel gains SMS and shop_settings
-- stores the local sms-gate gateway connection (URL + basic-auth credentials,
-- password encrypted like the WhatsApp token) plus the secret path token for
-- the inbound webhook.
ALTER TYPE "NotifyChannel" ADD VALUE IF NOT EXISTS 'SMS';

ALTER TABLE "shop_settings"
  ADD COLUMN IF NOT EXISTS "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "smsGatewayUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "smsGatewayUser" TEXT,
  ADD COLUMN IF NOT EXISTS "smsGatewayPasswordEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "smsWebhookToken" TEXT;
