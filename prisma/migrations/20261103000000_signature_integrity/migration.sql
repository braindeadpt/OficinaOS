-- Signature integrity: bind the signature to the document the customer saw
-- (frozen terms + ficha snapshot) and record remote-signing provenance.
ALTER TABLE "jobs"
  ADD COLUMN "intakeTermsSnapshot" JSONB,
  ADD COLUMN "intakeDocumentHash" TEXT,
  ADD COLUMN "signedAt" TIMESTAMPTZ,
  ADD COLUMN "signedVia" TEXT,
  ADD COLUMN "signedIp" TEXT,
  ADD COLUMN "signedUserAgent" TEXT;

ALTER TABLE "signature_sessions"
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "documentHash" TEXT,
  ADD COLUMN "signedAt" TIMESTAMPTZ,
  ADD COLUMN "signerIp" TEXT,
  ADD COLUMN "signerUserAgent" TEXT;
