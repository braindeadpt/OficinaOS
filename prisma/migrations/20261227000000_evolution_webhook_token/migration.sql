-- Webhook inbound da Evolution ganha segredo próprio, separado do SMS.
-- Antes o callback registado usava smsWebhookToken: quem lê a config do
-- webhook na Evolution ficava com a credencial que autentica envios SMS
-- (aceitar/recusar orçamentos em nome do cliente), e gravar definições
-- SMS rodava o token e partia o callback do bot.
--
-- Instalações que já tinham o bot aceite migram sozinhas: o próximo save
-- ou re-pair gera evolutionWebhookToken e regista o callback novo.
ALTER TABLE "shop_settings" ADD COLUMN "evolutionWebhookToken" TEXT;
