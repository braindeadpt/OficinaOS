-- V0.5 pre-triage: staff alert for public pre-check submissions.
-- INSERT-only and ON CONFLICT-safe, same as the quote_sent seed.
INSERT INTO "notification_templates"
  ("id", "name", "channel", "body", "isDefault", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'pre_check_submitted',
    'IN_APP',
    'New pre-check request{{if requestCode}} — {{requestCode}}{{endif}}{{if customerName}} from {{customerName}}{{endif}}{{if deviceLabel}} ({{deviceLabel}}){{endif}}',
    true,
    now(),
    now()
  )
ON CONFLICT ("name", "channel") DO NOTHING;
