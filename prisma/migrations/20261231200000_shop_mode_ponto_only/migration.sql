-- Modo da instância: OficinaOS completa ou Livro de Ponto standalone.
ALTER TABLE "shop_settings"
  ADD COLUMN "shopMode" TEXT NOT NULL DEFAULT 'repair_shop';

ALTER TABLE "shop_settings"
  ADD CONSTRAINT "shop_settings_shopMode_check"
  CHECK ("shopMode" IN ('repair_shop', 'ponto_only'));
