-- «Pedir sempre a localização» no livro de ponto — desligado por omissão.
ALTER TABLE "shop_settings"
  ADD COLUMN IF NOT EXISTS "pontoAlwaysAskLocation" BOOLEAN NOT NULL DEFAULT false;
