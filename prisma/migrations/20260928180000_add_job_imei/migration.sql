-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "imei" VARCHAR(16);

-- CreateIndex
CREATE INDEX "jobs_imei_idx" ON "jobs"("imei");
