-- Staff-initiated signature link: when the employee clicks "send link" on a
-- signing session (intake ficha or loaner term) the customer must get the
-- URL — this template carries the transactional text for the outbox.
-- INSERT-only and ON CONFLICT-safe: customized templates keep their bodies;
-- only the new signature_link templates are added. The SMS channel reuses
-- the WhatsApp body as fallback (no *bold* markers present anyway), and
-- IN_APP records the send on the staff member's own notification feed.
INSERT INTO "notification_templates"
  ("id", "name", "channel", "body", "isDefault", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'signature_link',
    'IN_APP',
    'Signature link sent to {{customerName}}{{if jobCode}} — {{jobCode}}{{endif}}',
    true,
    now(),
    now()
  ),
  (
    gen_random_uuid()::text,
    'signature_link',
    'WHATSAPP',
    E'Hello {{customerName}}, please review and sign {{docLabel}}{{if jobCode}} for repair {{jobCode}}{{endif}}: {{signUrl}} (valid for {{ttlMinutes}} min).{{if shopName}} — {{shopName}}{{endif}}',
    true,
    now(),
    now()
  )
ON CONFLICT ("name", "channel") DO NOTHING;
