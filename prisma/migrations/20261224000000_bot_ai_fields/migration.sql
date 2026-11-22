-- AlterTable
ALTER TABLE "JobPartsWaiting" ADD COLUMN "expectedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "botAiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "botAvgRepairDaysAfterPart" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "botClosedFallbackText" TEXT,
ADD COLUMN "botInfoText" TEXT;
