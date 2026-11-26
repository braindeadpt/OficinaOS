-- WP0.6 PR B — aviso retrospetivo único às lojas cujas credenciais Meta
-- foram migradas para a OficinaOS Cloud antes de existir consentimento explícito.

ALTER TABLE "shop_settings" ADD COLUMN "whatsappCloudMigrationNoticeSeenAt" TIMESTAMPTZ;
