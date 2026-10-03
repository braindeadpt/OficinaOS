-- Job.portalPublishedAt: marks that the job's public tracking page was
-- pushed to OficinaOS Cloud (module: portal). accessCode doubles as the
-- public URL token.
ALTER TABLE "jobs" ADD COLUMN "portalPublishedAt" TIMESTAMPTZ(6);
