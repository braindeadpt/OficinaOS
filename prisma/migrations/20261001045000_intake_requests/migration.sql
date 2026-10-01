-- CreateEnum
CREATE TYPE "IntakeRequestStatus" AS ENUM ('PENDING', 'CONVERTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "intake_request_counters" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intake_request_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "intake_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "deviceLabel" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "status" "IntakeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "intake_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intake_requests_code_key" ON "intake_requests"("code");

-- CreateIndex
CREATE INDEX "intake_requests_status_createdAt_idx" ON "intake_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
