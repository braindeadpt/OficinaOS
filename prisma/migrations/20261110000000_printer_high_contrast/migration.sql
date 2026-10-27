-- ESC/POS "alto contraste": wraps every text line in ESC E (bold). Impressoras
-- com densidade baixa ou cabeça/papel gasto imprimiam o corpo do talão quase
-- ilegível — só os cabeçalhos (já bold) saíam bem.
ALTER TABLE "shop_settings"
  ADD COLUMN IF NOT EXISTS "printerHighContrast" BOOLEAN NOT NULL DEFAULT false;
