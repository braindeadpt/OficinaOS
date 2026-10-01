-- OficinaOS Cloud pairing fields on shop_settings
ALTER TABLE "shop_settings" ADD COLUMN "cloudApiUrl" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "cloudShopTokenEncrypted" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "cloudShopId" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "cloudShopName" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "cloudEntitlements" JSONB;
ALTER TABLE "shop_settings" ADD COLUMN "cloudSyncedAt" TIMESTAMPTZ;
