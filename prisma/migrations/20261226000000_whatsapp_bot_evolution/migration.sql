-- §5.7 — bot WhatsApp no transporte Evolution (Pro com termo próprio)

-- Termo de responsabilidade do bot (separado do disclaimer do transporte),
-- quem aceitou, teto diário configurável e suspensão automática por erro
-- de sessão da Evolution.
ALTER TABLE "shop_settings" ADD COLUMN "whatsappBotDisclaimerAt" TIMESTAMPTZ;
ALTER TABLE "shop_settings" ADD COLUMN "whatsappBotDisclaimerUserId" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "whatsappBotDailyCap" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "shop_settings" ADD COLUMN "whatsappBotSuspendedAt" TIMESTAMPTZ;
