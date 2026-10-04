-- Direct network printing (ESC/POS over TCP). printerMode "browser" keeps the
-- current OS print-dialog flow; "escpos" sends bytes to printerHost:printerPort.
ALTER TABLE "shop_settings"
  ADD COLUMN IF NOT EXISTS "printerMode" TEXT NOT NULL DEFAULT 'browser',
  ADD COLUMN IF NOT EXISTS "printerHost" TEXT,
  ADD COLUMN IF NOT EXISTS "printerPort" INTEGER NOT NULL DEFAULT 9100;
