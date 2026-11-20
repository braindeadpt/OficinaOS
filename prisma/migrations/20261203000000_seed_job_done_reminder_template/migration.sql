-- Pickup reminder: when a repair sits DONE (ready, uncollected) for days
-- the scheduler nudges the customer — this template carries the text.
-- INSERT-only and ON CONFLICT-safe: customized templates keep their bodies;
-- only the new job_done_reminder templates are added. SMS falls back to the
-- WhatsApp body (no *bold* markers), and IN_APP records each send for the
-- owner. Bodies are the English defaults — seed.ts upgrades untouched rows
-- to PT-PT.
INSERT INTO "notification_templates"
  ("id", "name", "channel", "body", "isDefault", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'job_done_reminder',
    'IN_APP',
    'Pickup reminder sent to {{customerName}}{{if jobCode}} — {{jobCode}}{{endif}}',
    true,
    now(),
    now()
  ),
  (
    gen_random_uuid()::text,
    'job_done_reminder',
    'WHATSAPP',
    E'Hello {{customerName}}, your repair {{jobCode}} has been ready for pickup for a few days — please come collect it when convenient.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}',
    true,
    now(),
    now()
  )
ON CONFLICT ("name", "channel") DO NOTHING;
