-- V0.2 counter automation: when staff sends a quote the customer must be
-- told — this template carries the consent-gated WhatsApp + in-app text.
-- INSERT-only and ON CONFLICT-safe: shops that customized templates keep
-- their bodies; only the new quote_sent template is added.
INSERT INTO "notification_templates"
  ("id", "name", "channel", "body", "isDefault", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'quote_sent',
    'IN_APP',
    'Quote sent{{if jobCode}} — {{jobCode}}{{endif}}{{if quoteAmount}} ({{quoteAmount}} {{currency}}){{endif}}',
    true,
    now(),
    now()
  ),
  (
    gen_random_uuid()::text,
    'quote_sent',
    'WHATSAPP',
    E'Hello {{customerName}}, the estimate for your repair {{jobCode}} is ready: {{quoteAmount}} {{currency}}.{{if trackingUrl}}\nReview and approve it here: {{trackingUrl}}{{endif}}{{if shopName}} — {{shopName}}{{endif}}',
    true,
    now(),
    now()
  )
ON CONFLICT ("name", "channel") DO NOTHING;
