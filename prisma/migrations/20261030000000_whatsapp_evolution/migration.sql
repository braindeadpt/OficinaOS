-- WhatsApp local (Evolution API) — transporte alternativo do módulo Pro
-- "whatsapp-bot" que corre na LAN da loja.
ALTER TABLE "ShopSettings"
  ADD COLUMN "whatsappTransport" TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN "evolutionUrl" TEXT,
  ADD COLUMN "evolutionInstance" TEXT,
  ADD COLUMN "evolutionApiKeyEncrypted" TEXT,
  ADD COLUMN "whatsappLocalDisclaimerAt" TIMESTAMPTZ;
