-- Livro de ponto — item 5 (lembrete de saída): a SAIDA presumida que o
-- sistema cria à hora do lembrete não chega por mensagem nenhuma —
-- precisa de proveniência própria no enum (o painel usa MANUAL para
-- registos manuais do responsável; aqui é o sistema).
--
-- IDEMPOTENTE: ADD VALUE IF NOT EXISTS tolera bases que já o tenham —
-- a branch do painel (feat/ponto-panel) traz a mesma alteração com outra
-- timestamp; quem aplicar as duas fica com um no-op.

ALTER TYPE "TimeEntryTransport" ADD VALUE IF NOT EXISTS 'MANUAL';
