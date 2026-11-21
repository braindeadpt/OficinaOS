-- Payments are fiscal records: a Job delete must never cascade them away.
-- Jobs are never hard-deleted in the app today, so this only hardens the
-- invariant at the DB level (defense in depth).
ALTER TABLE "payments" DROP CONSTRAINT "payments_jobId_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
