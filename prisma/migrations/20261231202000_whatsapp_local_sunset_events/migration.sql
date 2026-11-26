-- Eventos visíveis/auditáveis da transição WhatsApp Cloud.
-- LOCAL_FALLBACK: envio direto local usado como reserva transitória após
-- falha de rede/5xx do relay Cloud. LOCAL_TOKEN_PURGED: token local removido
-- depois do fim do prazo. Os eventos nunca incluem segredos nem payloads.

CREATE TYPE "WhatsAppMigrationEventType" AS ENUM ('LOCAL_FALLBACK', 'LOCAL_TOKEN_PURGED');

CREATE TABLE "whatsapp_migration_events" (
    "id" TEXT NOT NULL,
    "type" "WhatsAppMigrationEventType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_migration_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_migration_events_createdAt_idx" ON "whatsapp_migration_events"("createdAt");
