-- Migração de privacidade (decisão do dono, 2026-11-26): as fotografias
-- de prova do trabalho externo deixam de existir no OficinaOS.
-- Os ficheiros e as linhas são apagados POR FOTOGRAFIA pelo script
-- server/scripts/shred-ponto-photos.ts, executado antes do
-- `prisma migrate deploy` no comando package.json `db:migrate-deploy`
-- e repetido em cada arranque: a linha de uma foto só cai quando todas
-- as cópias do ficheiro desapareceram. A tabela só é removida quando
-- estiver vazia — enquanto houver fotografias por apagar, as linhas
-- ficam (são o aviso das Definições do ponto) e a limpeza continua.

DO $$
BEGIN
  IF to_regclass('public.ponto_photos') IS NULL THEN
    RAISE NOTICE 'ponto photo privacy migration: ponto_photos already absent';
  ELSIF (SELECT count(*) FROM "ponto_photos") = 0 THEN
    DROP TABLE "ponto_photos";
    RAISE NOTICE 'ponto photo privacy migration: ponto_photos empty — dropped';
  ELSE
    RAISE NOTICE 'ponto photo privacy migration: ponto_photos kept — % photos pending cleanup (see Ponto settings)',
      (SELECT count(*) FROM "ponto_photos");
  END IF;
END $$;
