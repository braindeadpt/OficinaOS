-- Adds the tracking deep link (digital receipt + warranty page) to the
-- job_delivered WhatsApp template. The UPDATE only touches rows still
-- carrying an untouched default body (upstream original or the v0.2 seed
-- variant), so shops that customized the message keep their text.
UPDATE notification_templates
SET body = E'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for trusting us!{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nYour receipt and warranty: {{trackingUrl}}{{endif}}'
WHERE name = 'job_delivered'
  AND channel = 'WHATSAPP'
  AND body IN (
    'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for choosing {{shopName}}!',
    'Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for trusting us!{{if shopName}} — {{shopName}}{{endif}}'
  );
