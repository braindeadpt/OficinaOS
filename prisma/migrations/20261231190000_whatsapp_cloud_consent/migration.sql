-- WP0.6 PR A — consentimento explícito para migrar o token Meta para a
-- OficinaOS Cloud + início imutável da transição de 30 dias do envio local.

ALTER TABLE "shop_settings" ADD COLUMN "whatsappCloudConsentAt" TIMESTAMPTZ;
ALTER TABLE "shop_settings" ADD COLUMN "whatsappLocalDeprecationWarnedAt" TIMESTAMPTZ;
