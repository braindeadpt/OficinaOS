-- Exportação ACT do Livro de Ponto: identificação fiscal/localidade da
-- empresa e marcação explícita de trabalhadores isentos de horário.
-- Aditiva e reversível manualmente; não altera nem apaga registos.

ALTER TABLE "shop_settings"
  ADD COLUMN IF NOT EXISTS "shopTaxId" TEXT,
  ADD COLUMN IF NOT EXISTS "shopLocality" TEXT;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "pontoScheduleExempt" BOOLEAN NOT NULL DEFAULT false;
