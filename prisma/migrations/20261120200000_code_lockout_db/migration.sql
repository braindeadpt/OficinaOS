-- Lockout de tentativas nos endpoints públicos de consulta por código
-- persistido na base de dados: antes ficava em memória e um restart limpava
-- os contadores.

CREATE TABLE "code_lockouts" (
    "code" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstFailedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_lockouts_pkey" PRIMARY KEY ("code")
);
