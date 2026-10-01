-- Cloud diag-intake: link an intake request to the cloud report it came
-- from (dedupe on redelivery) and keep the full diagnostic payload.
ALTER TABLE "intake_requests" ADD COLUMN "externalId" TEXT;
ALTER TABLE "intake_requests" ADD COLUMN "diagnostic" JSONB;

CREATE UNIQUE INDEX "intake_requests_externalId_key" ON "intake_requests"("externalId");
