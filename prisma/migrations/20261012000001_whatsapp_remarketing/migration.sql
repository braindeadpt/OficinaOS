ALTER TABLE "customers" ADD COLUMN "lastRemarketingAt" TIMESTAMPTZ;

ALTER TABLE "shop_settings" ADD COLUMN "remarketingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shop_settings" ADD COLUMN "remarketingDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "shop_settings" ADD COLUMN "remarketingCooldownDays" INTEGER NOT NULL DEFAULT 180;
ALTER TABLE "shop_settings" ADD COLUMN "remarketingTemplate" TEXT;
