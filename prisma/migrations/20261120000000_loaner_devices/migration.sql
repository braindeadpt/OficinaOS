-- Frota de equipamentos de empréstimo (loaner devices). O estado "emprestado"
-- é derivado: um job referencia a unidade com "loanerReturnedAt" NULL e estado
-- não-CANCELLED — um cliente que fica com ela depois da entrega continua
-- visível em vez de a libertar silenciosamente.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOANER_RETURNED';

CREATE TABLE IF NOT EXISTS "loaner_devices" (
  "id"         TEXT                     NOT NULL,
  "label"      VARCHAR(120)             NOT NULL,
  "brand"      VARCHAR(60),
  "model"      VARCHAR(120),
  "imei"       VARCHAR(32),
  "notes"      TEXT,
  "active"     BOOLEAN                  NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMPTZ              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMPTZ              NOT NULL,

  CONSTRAINT "loaner_devices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "loaner_devices_active_idx"
  ON "loaner_devices"("active");

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "loanerDeviceId"   TEXT,
  ADD COLUMN IF NOT EXISTS "loanerReturnedAt" TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_loanerDeviceId_fkey'
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_loanerDeviceId_fkey"
      FOREIGN KEY ("loanerDeviceId")
      REFERENCES "loaner_devices"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "jobs_loanerDeviceId_idx"
  ON "jobs"("loanerDeviceId");

-- Uma unidade nunca sai duas vezes: no máximo um job com empréstimo em aberto
-- (não devolvido e não cancelado) por unidade, garantido pela BD mesmo sob
-- admissões concorrentes.
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_open_loaner_uniq"
  ON "jobs"("loanerDeviceId")
  WHERE "loanerReturnedAt" IS NULL AND "status" <> 'CANCELLED';
