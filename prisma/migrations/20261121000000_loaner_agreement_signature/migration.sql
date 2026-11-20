-- Assinatura digital do termo de responsabilidade do empréstimo — um
-- documento separado da ficha de entrada. O snapshot guarda o documento
-- canónico assinado (cláusulas, identidade da unidade, cliente, datas,
-- locale) e o hash é sha256(doc canónico + assinatura), igual à ficha.
-- Reimpressão compara o snapshot com os dados atuais do job e cai para a
-- linha de assinatura em papel quando já não coincidem.

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "loanerAgreementSignatureDataUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "loanerAgreementSnapshot"         JSONB,
  ADD COLUMN IF NOT EXISTS "loanerAgreementDocumentHash"     TEXT,
  ADD COLUMN IF NOT EXISTS "loanerAgreementSignedAt"         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "loanerAgreementSignedVia"        TEXT,
  ADD COLUMN IF NOT EXISTS "loanerAgreementSignerIp"         TEXT,
  ADD COLUMN IF NOT EXISTS "loanerAgreementSignerUserAgent"  TEXT;
