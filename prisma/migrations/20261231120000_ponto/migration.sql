-- Módulo Pro "ponto" (livro de ponto por WhatsApp/SMS) — item 1: modelos
-- de dados + definições da loja + proteção de imutabilidade dos registos.
--
-- time_entries é append-only por desenho (Código do Trabalho — correções
-- fazem-se com linhas novas via correctsId): triggers BEFORE UPDATE/DELETE
-- bloqueiam qualquer mutação. Escape hatch para a limpeza de retenção
-- (5 anos): dentro da transação, SET LOCAL oficinaos.ponto_purge='on'.
-- TRUNCATE não dispara triggers de linha — o reset da demo não é afetado.
--
-- IDEMPOTENTE por desenho (mesmo padrão das migrações recentes): cada
-- operação tolera "já existe" — bases de teste persistentes podem correr
-- partes noutros nomes.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimeEntryType') THEN
    CREATE TYPE "TimeEntryType" AS ENUM ('ENTRADA', 'PAUSA', 'VOLTEI', 'SAIDA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimeEntryTransport') THEN
    CREATE TYPE "TimeEntryTransport" AS ENUM ('WHATSAPP_META', 'WHATSAPP_EVOLUTION', 'SMS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimeEntryStatus') THEN
    CREATE TYPE "TimeEntryStatus" AS ENUM ('APROVADO', 'POR_VALIDAR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TimeEntryDecision') THEN
    CREATE TYPE "TimeEntryDecision" AS ENUM ('APROVADO', 'RECUSADO');
  END IF;
END $$;

-- AlterTable — User: identidade ponto + flags do módulo.
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "phoneE164" TEXT,
ADD COLUMN IF NOT EXISTS "pontoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "externalWork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "pontoSmsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "pontoScheduleStart" TEXT,
ADD COLUMN IF NOT EXISTS "pontoScheduleEnd" TEXT;

-- CreateIndex — phoneE164 é a chave de correspondência das mensagens;
-- única quando preenchida (Postgres admite vários NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "users_phoneE164_key" ON "users"("phoneE164");

-- AlterTable — ShopSettings: geolocalização da loja, raio, externos,
-- lembretes e os números que o QR divulga.
ALTER TABLE "shop_settings"
ADD COLUMN IF NOT EXISTS "pontoGeoLat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "pontoGeoLng" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "pontoRadiusM" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS "pontoExternalAutoApprove" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "pontoExternalPhotoRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "pontoExitReminderTime" TEXT,
ADD COLUMN IF NOT EXISTS "pontoPauseReminderMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN IF NOT EXISTS "pontoInfoText" TEXT,
ADD COLUMN IF NOT EXISTS "pontoWaNumber" TEXT,
ADD COLUMN IF NOT EXISTS "pontoSmsNumber" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "time_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TimeEntryType" NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,
    "transport" "TimeEntryTransport" NOT NULL,
    "status" "TimeEntryStatus" NOT NULL,
    "proofs" JSONB NOT NULL,
    "reason" TEXT,
    "correctsId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "time_entry_validations" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "decision" "TimeEntryDecision" NOT NULL,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "time_entry_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable — fotos de prova (externos / foto exigida): apagadas aos
-- 90 dias por rotina; entryId é referência solta (a foto chega antes do
-- registo e expira muito antes dele).
CREATE TABLE IF NOT EXISTS "ponto_photos" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryId" TEXT,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ponto_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "time_entries_userId_at_idx" ON "time_entries"("userId", "at");
CREATE INDEX IF NOT EXISTS "time_entries_status_at_idx" ON "time_entries"("status", "at");
CREATE INDEX IF NOT EXISTS "time_entries_at_idx" ON "time_entries"("at");
CREATE INDEX IF NOT EXISTS "time_entry_validations_entryId_idx" ON "time_entry_validations"("entryId");
CREATE INDEX IF NOT EXISTS "time_entry_validations_byUserId_idx" ON "time_entry_validations"("byUserId");
CREATE INDEX IF NOT EXISTS "ponto_photos_userId_idx" ON "ponto_photos"("userId");
CREATE INDEX IF NOT EXISTS "ponto_photos_entryId_idx" ON "ponto_photos"("entryId");

-- AddForeignKey — pg_constraint não tem IF NOT EXISTS: salta os que já
-- existam.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_userId_fkey' AND conrelid = 'time_entries'::regclass) THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_correctsId_fkey' AND conrelid = 'time_entries'::regclass) THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_createdById_fkey' AND conrelid = 'time_entries'::regclass) THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entry_validations_entryId_fkey' AND conrelid = 'time_entry_validations'::regclass) THEN
    ALTER TABLE "time_entry_validations" ADD CONSTRAINT "time_entry_validations_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entry_validations_byUserId_fkey' AND conrelid = 'time_entry_validations'::regclass) THEN
    ALTER TABLE "time_entry_validations" ADD CONSTRAINT "time_entry_validations_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ponto_photos_userId_fkey' AND conrelid = 'ponto_photos'::regclass) THEN
    ALTER TABLE "ponto_photos" ADD CONSTRAINT "ponto_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Imutabilidade dos registos de ponto — UPDATE e DELETE falham sempre;
-- a única saída é o GUC oficinaos.ponto_purge (retenção de 5 anos).
CREATE OR REPLACE FUNCTION ponto_timeentry_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('oficinaos.ponto_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'time_entries é imutável — correções fazem-se com novas linhas (correctsId)';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS timeentry_no_update ON time_entries;
CREATE TRIGGER timeentry_no_update BEFORE UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION ponto_timeentry_immutable();

DROP TRIGGER IF EXISTS timeentry_no_delete ON time_entries;
CREATE TRIGGER timeentry_no_delete BEFORE DELETE ON time_entries FOR EACH ROW EXECUTE FUNCTION ponto_timeentry_immutable();
