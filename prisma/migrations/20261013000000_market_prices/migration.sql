ALTER TABLE "shop_settings" ADD COLUMN "sharePrices" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shop_settings" ADD COLUMN "pricesDirty" BOOLEAN NOT NULL DEFAULT true;
