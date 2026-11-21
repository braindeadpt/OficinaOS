-- One open (SENT) external repair per job — enforced at the DB level so two
-- concurrent sends cannot both persist.
CREATE UNIQUE INDEX "external_repairs_one_open_per_job"
  ON "external_repairs"("jobId")
  WHERE "status" = 'SENT';
