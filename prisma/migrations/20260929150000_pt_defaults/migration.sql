-- AlterTable: switch shop_settings defaults to Portugal/EUR for new installs.
ALTER TABLE "shop_settings" ALTER COLUMN "countryCode" SET DEFAULT 'PT';
ALTER TABLE "shop_settings" ALTER COLUMN "currency" SET DEFAULT 'EUR';
