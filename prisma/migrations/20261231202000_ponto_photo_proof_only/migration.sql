-- Migração destrutiva de privacidade (decisão do dono, 2026-11-26):
-- as fotografias de prova do trabalho externo deixam de existir no OficinaOS.
-- As linhas em ponto_photos são eliminadas antes de a tabela ser removida.
-- Os ficheiros em UPLOAD_DIR/ponto-photos são apagados pelo script
-- server/scripts/shred-ponto-photos.ts, executado antes de `prisma migrate deploy`
-- no comando package.json `db:migrate-deploy` (falha fecha a atualização).

DO $$
DECLARE
  deleted_count integer := 0;
BEGIN
  IF to_regclass('public.ponto_photos') IS NOT NULL THEN
    DELETE FROM "ponto_photos";
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'ponto photo privacy migration: deleted % PontoPhoto rows', deleted_count;
  ELSE
    RAISE NOTICE 'ponto photo privacy migration: ponto_photos already absent';
  END IF;
END $$;

DROP TABLE IF EXISTS "ponto_photos";
