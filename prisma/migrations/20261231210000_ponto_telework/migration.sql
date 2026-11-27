-- Teletrabalho (R3 da AIPD): dias de teletrabalho por trabalhador e regra
-- da empresa para a validação de registos remotos. Só aditivo.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pontoTeleworkDays" INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE "shop_settings" ADD COLUMN IF NOT EXISTS "pontoRemoteAutoApprove" BOOLEAN NOT NULL DEFAULT false;
