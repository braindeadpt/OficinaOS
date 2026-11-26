-- Data da última gravação explícita do token Meta local. Permite distinguir
-- o token legado que existia durante a transição de um token introduzido depois
-- do prazo apenas para completar a migração consentida para a Cloud.
ALTER TABLE "shop_settings" ADD COLUMN "whatsappApiTokenWrittenAt" TIMESTAMPTZ;
