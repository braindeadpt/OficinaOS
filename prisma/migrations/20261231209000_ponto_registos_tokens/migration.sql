-- Direito de acesso (art. 15.º RGPD): tokens de uso único para o PDF mensal
-- do próprio trabalhador, servido pela app. Só aditivo.
CREATE TABLE IF NOT EXISTS "ponto_registos_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ponto_registos_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ponto_registos_tokens_tokenHash_key" ON "ponto_registos_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "ponto_registos_tokens_userId_createdAt_idx" ON "ponto_registos_tokens"("userId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ponto_registos_tokens_userId_fkey'
    ) THEN
        ALTER TABLE "ponto_registos_tokens"
            ADD CONSTRAINT "ponto_registos_tokens_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
