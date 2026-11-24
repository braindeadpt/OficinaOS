-- Livro de ponto — item 5: alerta IN_APP ao gestor/owner quando a
-- SAIDA presumida fica >60 min sem correção do trabalhador.
-- notify() resolve o corpo por (name, channel=IN_APP); sem esta linha
-- a notificação saía com o corpo por defeito.
INSERT INTO "notification_templates"
  ("id", "name", "channel", "body", "isDefault", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'ponto_saida_pendente',
    'IN_APP',
    'Livro de ponto: {{workerName}} não confirmou a saída das {{exitTime}} — registo presumido por validar.',
    true,
    now(),
    now()
  )
ON CONFLICT ("name", "channel") DO NOTHING;
