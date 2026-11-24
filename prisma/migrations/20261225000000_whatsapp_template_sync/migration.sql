-- §5.6 — WhatsApp template sync automático

-- Parâmetros posicionais ({{1}}…{{n}}) para envio Meta type:"template".
ALTER TABLE "notification_outbox" ADD COLUMN "templateParams" JSONB;

-- Estado por template Meta após o último sync automático (lido pela UI).
ALTER TABLE "shop_settings" ADD COLUMN "whatsappTemplatesJson" JSONB;
