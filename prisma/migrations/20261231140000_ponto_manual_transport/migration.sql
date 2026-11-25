-- Livro de ponto — item 4 (painel): registos manuais feitos pelo
-- responsável no painel precisam de proveniência própria. Sem MANUAL no
-- enum, um lançamento manual teria de fingir um transporte de mensagem.
--
-- IDEMPOTENTE: ADD VALUE IF NOT EXISTS tolera bases que já o tenham
-- (Postgres não permite usar o valor novo na mesma transação, mas
-- migrações correm fora de transação — seguro).

ALTER TYPE "TimeEntryTransport" ADD VALUE IF NOT EXISTS 'MANUAL';
