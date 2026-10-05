ALTER TABLE "customers" ADD COLUMN "taxId" TEXT;

ALTER TABLE "sales" ADD COLUMN "invoiceDocId" TEXT;
ALTER TABLE "sales" ADD COLUMN "invoiceDocType" TEXT;
ALTER TABLE "sales" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "sales" ADD COLUMN "invoicePermalink" TEXT;
ALTER TABLE "sales" ADD COLUMN "invoicedAt" TIMESTAMPTZ;

ALTER TABLE "jobs" ADD COLUMN "invoiceDocId" TEXT;
ALTER TABLE "jobs" ADD COLUMN "invoiceDocType" TEXT;
ALTER TABLE "jobs" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "jobs" ADD COLUMN "invoicePermalink" TEXT;
ALTER TABLE "jobs" ADD COLUMN "invoicedAt" TIMESTAMPTZ;

ALTER TABLE "shop_settings" ADD COLUMN "invoicingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shop_settings" ADD COLUMN "invoicingAccount" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "invoicingApiKeyEncrypted" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "invoicingTaxName" TEXT NOT NULL DEFAULT 'IVA23';
