-- Customer-facing quote approval on the public tracking page.
-- Sending a new quote supersedes the previous SENT one (rejection -> revise
-- -> resend v2). Responses arrive via the public code+phone4 endpoint.
CREATE TYPE "QuoteStatus" AS ENUM ('SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED');

ALTER TYPE "AuditAction" ADD VALUE 'QUOTE_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'QUOTE_RESPONDED';

CREATE TABLE "job_quotes" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ,
    "responseNote" TEXT,

    CONSTRAINT "job_quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_quotes_jobId_version_key" ON "job_quotes"("jobId", "version");
CREATE INDEX "job_quotes_jobId_idx" ON "job_quotes"("jobId");

ALTER TABLE "job_quotes" ADD CONSTRAINT "job_quotes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
