-- Widget embed + supplier hardening (PR B):
--   1. shop_settings.embedAllowedOrigins — origins allowed to iframe
--      /embed/* (CSP frame-ancestors). One origin per line; NULL/empty = '*'.
--   2. parts_catalog.supplierId — FK to suppliers (ON DELETE SET NULL),
--      backfilled by exact (case-insensitive, trimmed) unique name match.
--   3. Indexes for supplier_rmas.partId / .createdById and
--      job_referrals.createdById — the detail/list lookups scan these.

ALTER TABLE "shop_settings" ADD COLUMN IF NOT EXISTS "embedAllowedOrigins" TEXT;

ALTER TABLE "parts_catalog" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

ALTER TABLE "parts_catalog"
    ADD CONSTRAINT "parts_catalog_supplierId_fkey" FOREIGN KEY ("supplierId")
    REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill only unambiguous matches: a supplier name that appears more than
-- once (case-insensitive) is left unlinked rather than guessed.
UPDATE "parts_catalog" pc
SET "supplierId" = s.id
FROM "suppliers" s
WHERE pc."supplier" IS NOT NULL
  AND lower(btrim(pc."supplier")) = lower(btrim(s.name))
  AND (
    SELECT count(*) FROM "suppliers" s2
    WHERE lower(btrim(s2.name)) = lower(btrim(s.name))
  ) = 1;

CREATE INDEX IF NOT EXISTS "parts_catalog_supplierId_idx" ON "parts_catalog"("supplierId");
CREATE INDEX IF NOT EXISTS "supplier_rmas_partId_idx" ON "supplier_rmas"("partId");
CREATE INDEX IF NOT EXISTS "supplier_rmas_createdById_idx" ON "supplier_rmas"("createdById");
CREATE INDEX IF NOT EXISTS "job_referrals_createdById_idx" ON "job_referrals"("createdById");
