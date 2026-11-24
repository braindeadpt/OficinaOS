-- Deterministic pre-quote snapshot built from the diagnostic checks against
-- the active catalogs — advisory only, never pre-fills a Job.
ALTER TABLE "intake_requests" ADD COLUMN "quoteSuggestion" JSONB;
