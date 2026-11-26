-- Proveniência legal dos termos assinados: o servidor passa a resolver o
-- texto e a registar a versão/data das definições usadas. Tudo aditivo;
-- assinaturas antigas ficam com estes campos NULL.
ALTER TABLE "shop_settings"
  ADD COLUMN IF NOT EXISTS "intakeTermsVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "intakeTermsUpdatedAt" TIMESTAMPTZ;

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "intakeTermsVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "intakeTermsUpdatedAt" TIMESTAMPTZ;

ALTER TABLE "signature_sessions"
  ADD COLUMN IF NOT EXISTS "intakeTermsVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "intakeTermsUpdatedAt" TIMESTAMPTZ;

UPDATE "shop_settings"
SET "intakeTermsUpdatedAt" = "updatedAt"
WHERE "intakeTerms" IS NOT NULL
  AND btrim("intakeTerms") <> ''
  AND "intakeTermsUpdatedAt" IS NULL;
