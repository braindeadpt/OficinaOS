-- Adds the review link ({{reviewUrl}}, from ShopSettings.reviewUrl) to the
-- job_delivered WhatsApp template. The UPDATE only touches rows still
-- carrying an untouched default body — shops that customized the message
-- keep their text. Older defaults are upgraded straight to the newest body
-- (tracking link + review link).
UPDATE notification_templates
SET body = E'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for trusting us!{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nYour receipt and warranty: {{trackingUrl}}{{endif}}{{if reviewUrl}}\nHappy with the repair? A quick review helps us a lot: {{reviewUrl}}{{endif}}'
WHERE name = 'job_delivered'
  AND channel = 'WHATSAPP'
  AND body IN (
    'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for choosing {{shopName}}!',
    'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for trusting us!{{if shopName}} — {{shopName}}{{endif}}',
    E'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for trusting us!{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nYour receipt and warranty: {{trackingUrl}}{{endif}}'
  );
