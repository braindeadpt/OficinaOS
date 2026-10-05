ALTER TABLE "parts_catalog" ADD COLUMN "listedOnline" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "shop_settings" ADD COLUMN "storePublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shop_settings" ADD COLUMN "storeDescription" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "storeSlug" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "storeEmail" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "storeDirty" BOOLEAN NOT NULL DEFAULT true;
