-- AlterTable
ALTER TABLE "job_parts_waiting" ADD COLUMN "expectedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN "botAiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "botAvgRepairDaysAfterPart" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "botClosedFallbackText" TEXT,
ADD COLUMN "botInfoText" TEXT;
