-- Purga dos tokens REGISTOS: um token usado ou expirado é inútil para
-- sempre, mas guarda metadados de acesso (que trabalhador pediu o próprio
-- PDF, quando) — passados 7 dias de vida morta essa memória deixa de ter
-- justificação e a purga diária remove-a, no mesmo SECURITY DEFINER que
-- já trata da retenção dos 5 anos. CREATE OR REPLACE preserva o dono
-- (oficinaos_ponto_purge nas instalações provisionadas) e os grants de
-- EXECUTE; só o corpo muda. Só aditivo para o resto do schema.
CREATE OR REPLACE FUNCTION ponto_purge_expired() RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  n bigint;
BEGIN
  -- Uma correção ainda dentro do prazo que aponte para um registo
  -- expirado perde o link ANTES do delete: o SET NULL da FK corre como
  -- dono da tabela e o trigger de imutabilidade rejeitava-o, fazendo
  -- abortar a purga inteira. Aqui corre como o papel da purga, que o
  -- trigger deixa passar. A linha da correção sobrevive — só o apontador
  -- para o registo purgado desaparece, como o SET NULL faria.
  UPDATE time_entries
     SET "correctsId" = NULL
   WHERE "correctsId" IN (
     SELECT id FROM time_entries WHERE "at" < now() - interval '5 years'
   );
  DELETE FROM time_entries WHERE "at" < now() - interval '5 years';
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Tokens REGISTOS mortos há mais de 7 dias: usados conta o usedAt,
  -- nunca usados conta o expiresAt. Um token ainda válido (não usado e
  -- por expirar) nunca entra — é a única forma de o link funcionar nas
  -- 24 h prometidas ao trabalhador.
  DELETE FROM ponto_registos_tokens
   WHERE ("usedAt" IS NOT NULL AND "usedAt" < now() - interval '7 days')
      OR ("usedAt" IS NULL AND "expiresAt" < now() - interval '7 days');

  RETURN n;
END;
$func$;

-- A função corre como o papel da purga (SECURITY DEFINER): ele precisa
-- de DELETE na tabela nova. O grant direto falharia numa instalação
-- fresca onde o papel ainda não existe (é o provisioning do arranque
-- que o cria) — daí o bloco com guarda, e o provisioning passa a repor
-- este grant também, para os restores.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oficinaos_ponto_purge') THEN
    EXECUTE 'GRANT SELECT, DELETE ON ponto_registos_tokens TO oficinaos_ponto_purge';
  END IF;
END $$;
