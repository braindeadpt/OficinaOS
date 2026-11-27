-- Registo de entrega da folha RGPD do Livro de Ponto. Aditiva; não altera
-- nem apaga picagens ou outros dados existentes.

CREATE TABLE IF NOT EXISTS "ponto_info_deliveries" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deliveredAt" DATE NOT NULL,
  "signed" BOOLEAN NOT NULL,
  "registeredById" TEXT NOT NULL,
  "registeredByName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ponto_info_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ponto_info_deliveries_userId_key" ON "ponto_info_deliveries"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ponto_info_deliveries_userId_fkey'
  ) THEN
    ALTER TABLE "ponto_info_deliveries"
      ADD CONSTRAINT "ponto_info_deliveries_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
