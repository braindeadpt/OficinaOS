-- Livro de ponto — item 5: template utility `ponto_lembrete`.
--
-- O lembrete de saída é business-initiated: fora da janela de 24 h do
-- WhatsApp oficial a Meta só aceita templates aprovados. O sync
-- automático (whatsapp-templates.service) submete à Meta todas as
-- NotificationTemplate WHATSAPP da loja — esta linha entra na fila de
-- aprovação no próximo sync. Corpo PT-PT com {{exitTime}} ("18:00") —
-- a hora configurada em Definições → pontoExitReminderTime.
-- INSERT-only e ON CONFLICT-safe: instalações que já tenham a linha
-- (seed manual) não a perdem.
INSERT INTO "notification_templates"
  ("id", "name", "channel", "body", "isDefault", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'ponto_lembrete',
    'WHATSAPP',
    'OficinaOS: ainda não tem saída registada. Saiu às {{exitTime}}? Responda SIM ou indique a hora.',
    true,
    now(),
    now()
  )
ON CONFLICT ("name", "channel") DO NOTHING;
