-- Revisão pós-merge 2026-11-25 — A1 (bloqueador), A2 e A3: o trigger de
-- imutabilidade passa a IMPOR a regra da purga em vez de confiar no papel.
--
-- A1 — antes bastava `SET ROLE oficinaos_ponto_purge` (a app em Docker é
-- superuser, logo qualquer sessão dela assume o papel) para apagar registos
-- com menos de 5 anos: o trigger verificava só `current_user`. Agora, mesmo
-- com o papel da purga, DELETE só passa se OLD."at" já passou a retenção
-- legal (5 anos) e UPDATE só passa se a única mudança for correctsId → NULL
-- — e mesmo essa só quando o registo corrigido já não existe (cascata da
-- FK após um delete fiscalizado) ou já passou a retenção (a purga a anular
-- links antes de apagar). Sem o papel não passa nada, como antes.
--
-- A2 — o comentário da migração original ("TRUNCATE não dispara triggers
-- de linha — o reset da demo não é afetado") lia-se como garantia e era o
-- contrário: TRUNCATE contornava tudo numa só instrução. Correção honesta
-- do modelo: contra o dono da tabela não há trigger que valha — ele pode
-- DISABLE TRIGGER, DROP TABLE, tudo. O que esta guarda BEFORE TRUNCATE faz
-- é fechar o acidente e o desvio casual (uma instrução solta, um script
-- apressado, injeção SQL que não conheça o mecanismo) e obrigar a intenção
-- explícita: o reset de demo e a limpeza dos testes passam por
-- SET LOCAL oficinaos.ponto_truncate='on' dentro da transação. Não é
-- barreira contra o dono — é impossível que o seja — mas já ninguém apaga
-- o livro inteiro por engano nem sem deixar intenção visível no código.
--
-- A3 — time_entry_validations não tinha proteção nenhuma: apagar um
-- RECUSADO mudava o estado do registo. Passa a ser só-acrescento: UPDATE
-- falha sempre; DELETE só passa quando o registo pai já não existe — ou
-- seja, em cascata de um delete que ele próprio já passou pelo trigger
-- fiscalizado de time_entries. A prova é a ausência do pai e não o papel
-- porque as ações internas da FK nunca correm como o papel da purga:
-- correm como o dono da tabela (verificado em Postgres 16), por isso um
-- teste a current_user nunca as deixaria passar.
--
-- As consultas dos triggers são schema-qualificadas e as funções fixam
-- search_path: sem isso, uma sessão que controlasse o search_path e um
-- schema sombra com uma time_entries vazia fazia o NOT EXISTS dar sempre
-- verdade — validações apagáveis e links de correção anuláveis em
-- registos vivos (reproduzido em Postgres 16 com GRANT USAGE ao papel).
--
-- IDEMPOTENTE por desenho (mesmo padrão das migrações do módulo).

-- ── A1: a regra passa a viver no trigger ────────────────────────────────
CREATE OR REPLACE FUNCTION ponto_timeentry_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Papel da purga e só ele, e só sobre registos fora da retenção
    -- legal (5 anos). Um registo dentro do prazo não há papel que o apague.
    IF current_user = 'oficinaos_ponto_purge'
       AND OLD."at" < now() - interval '5 years' THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND OLD."correctsId" IS NOT NULL
    AND NEW."correctsId" IS NULL
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
    AND NEW.type IS NOT DISTINCT FROM OLD.type
    AND NEW."at" IS NOT DISTINCT FROM OLD."at"
    AND NEW.transport IS NOT DISTINCT FROM OLD.transport
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.proofs IS NOT DISTINCT FROM OLD.proofs
    AND NEW.reason IS NOT DISTINCT FROM OLD.reason
    AND NEW."createdById" IS NOT DISTINCT FROM OLD."createdById"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
  THEN
    -- A única mutação tolerada: desligar a correção do registo corrigido,
    -- e só quando esse registo já passou a retenção ou já não existe.
    -- O segundo caso é a cascata interna do ON DELETE SET NULL — corre
    -- como o dono da tabela, nunca como o papel da purga, e é legítima em
    -- qualquer contexto: o delete do alvo já foi fiscalizado pelo ramo de
    -- DELETE acima, e o estado consistente exige o link anulado. O primeiro
    -- é a purga a anular links antes de apagar (ponto_purge_expired).
    IF NOT EXISTS (SELECT 1 FROM public.time_entries WHERE id = OLD."correctsId") THEN
      RETURN NEW;
    END IF;
    IF current_user = 'oficinaos_ponto_purge'
       AND (SELECT t."at" FROM public.time_entries t WHERE t.id = OLD."correctsId")
           < now() - interval '5 years' THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'time_entries é imutável — correções fazem-se com novas linhas (correctsId)';
END; $$;

-- ── A3: validações só-acrescento ────────────────────────────────────────
CREATE OR REPLACE FUNCTION ponto_validation_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- DELETE só passa quando o registo pai já não existe: a cascata do
  -- ON DELETE CASCADE corre depois do delete do pai, que por sua vez só
  -- passou pelo trigger de time_entries se fosse a purga fora da retenção.
  -- Uma validação cujo pai existe não se apaga com papel nenhum — apagar
  -- um RECUSADO mudava o estado do registo, e é isso que fecha aqui.
  -- UPDATE não tem saída nenhuma: uma decisão tomada não se altera.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.time_entries WHERE id = OLD."entryId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'time_entry_validations é só-acrescento — uma decisão não se apaga nem se altera';
END; $$;

DROP TRIGGER IF EXISTS validation_no_update ON time_entry_validations;
CREATE TRIGGER validation_no_update BEFORE UPDATE ON time_entry_validations FOR EACH ROW EXECUTE FUNCTION ponto_validation_immutable();

DROP TRIGGER IF EXISTS validation_no_delete ON time_entry_validations;
CREATE TRIGGER validation_no_delete BEFORE DELETE ON time_entry_validations FOR EACH ROW EXECUTE FUNCTION ponto_validation_immutable();

-- ── A2: guarda de TRUNCATE (speed bump — ver o cabeçalho) ───────────────
CREATE OR REPLACE FUNCTION ponto_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- O escape é um GUC de transação: quem trunca tem de o declarar no
  -- código (reset de demo, limpeza de testes). Sem ele — incluindo uma
  -- sessão manual ou injeção SQL — o livro inteiro não cai numa instrução.
  IF current_setting('oficinaos.ponto_truncate', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% não admite TRUNCATE — livro de ponto legal (retenção de 5 anos)', TG_TABLE_NAME;
END; $$;

DROP TRIGGER IF EXISTS timeentry_no_truncate ON time_entries;
CREATE TRIGGER timeentry_no_truncate BEFORE TRUNCATE ON time_entries FOR EACH STATEMENT EXECUTE FUNCTION ponto_no_truncate();

DROP TRIGGER IF EXISTS validation_no_truncate ON time_entry_validations;
CREATE TRIGGER validation_no_truncate BEFORE TRUNCATE ON time_entry_validations FOR EACH STATEMENT EXECUTE FUNCTION ponto_no_truncate();
