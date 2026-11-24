-- createdById passa a ON DELETE RESTRICT (era SET NULL): o trigger de
-- imutabilidade (timeentry_no_update) rejeita o UPDATE que o SET NULL
-- dispararia ao apagar uma conta de utilizador, e a autoria de um registo
-- legal (Código do Trabalho) não se remove. O fluxo da app nunca elimina
-- contas — desativa-as (users.isActive) —, logo o Restrict só morde em
-- limpeza manual à BD, que é exatamente o que se quer impedir.
-- Idempotente como as restantes migrações do módulo.
ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_createdById_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_createdById_fkey' AND conrelid = 'time_entries'::regclass) THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
