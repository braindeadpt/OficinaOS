-- WP0.3 — fecha o escape do GUC oficinaos.ponto_purge: qualquer sessão
-- fazia SET LOCAL oficinaos.ponto_purge='on' e mutilava o livro de ponto
-- (auditoria 2026-11-25, P0). A purga da retenção (5 anos) passa a correr
-- SÓ pela função SECURITY DEFINER ponto_purge_expired(), pertencente ao
-- papel próprio oficinaos_ponto_purge (NOLOGIN): o trigger só abre para
-- esse papel e a função fixa o corte legal — não aceita parâmetros, por
-- isso nem o dono da BD a pode usar para apagar registos dentro do prazo.
-- Um superuser continua a poder tudo (DROP TRIGGER), como sempre — mas
-- deixa de bastar "qualquer sessão".
--
-- IDEMPOTENTE por desenho (mesmo padrão das migrações recentes). Em
-- ambientes sem privilégio para criar papéis a migração continua com
-- aviso e fecha tudo na mesma — a purga fica simplesmente indisponível
-- até o papel existir (falha fechada, nunca aberta).

-- Papel próprio da purga — sem login.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oficinaos_ponto_purge') THEN
    CREATE ROLE oficinaos_ponto_purge NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'sem privilégio para criar o papel oficinaos_ponto_purge — cria-o manualmente; a purga fica indisponível até lá';
END $$;

-- O trigger deixa de olhar para o GUC: só o papel da purga muta.
CREATE OR REPLACE FUNCTION ponto_timeentry_immutable() RETURNS trigger AS $$
BEGIN
  IF current_user = 'oficinaos_ponto_purge' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'time_entries é imutável — correções fazem-se com novas linhas (correctsId)';
END; $$ LANGUAGE plpgsql;

-- Privilégios mínimos do papel sobre as tabelas (as validações caem em
-- cascata pela FK; o GRANT explícito é barato e inequívoco).
DO $$
BEGIN
  -- SELECT é mesmo preciso: o DELETE com WHERE que lê colunas (o corte
  -- dos 5 anos lê "at") exige SELECT nessas colunas — sem ele a purga
  -- falha com "permission denied" apesar do GRANT DELETE.
  GRANT SELECT, DELETE ON time_entries TO oficinaos_ponto_purge;
  GRANT SELECT, DELETE ON time_entry_validations TO oficinaos_ponto_purge;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE WARNING 'não consegui dar DELETE ao papel oficinaos_ponto_purge — a purga falha até ser corrigido';
END $$;

-- A purga: sem parâmetros, o corte é sempre o legal (5 anos). Devolve o
-- número de linhas apagadas.
CREATE OR REPLACE FUNCTION ponto_purge_expired() RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  n bigint;
BEGIN
  DELETE FROM time_entries WHERE "at" < now() - interval '5 years';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

-- A função passa a pertencer ao papel da purga — é isso que a faz correr
-- como oficinaos_ponto_purge e abrir o trigger.
DO $$
BEGIN
  EXECUTE 'ALTER FUNCTION ponto_purge_expired() OWNER TO oficinaos_ponto_purge';
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE WARNING 'não consegui entregar ponto_purge_expired ao papel oficinaos_ponto_purge — a purga falha até ser corrigido';
END $$;

-- Quem chama a purga: só papéis com EXECUTE explícito. Por omissão fica
-- o utilizador que corre as migrações (o papel operacional da app) —
-- o suficiente para o job de retenção e para operação manual.
REVOKE ALL ON FUNCTION ponto_purge_expired() FROM PUBLIC;
DO $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION ponto_purge_expired() TO %I', current_user);
END $$;
