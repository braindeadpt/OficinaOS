-- Webhook URL público devolvido pela cloud no push de credenciais —
-- mostrado na UI para a loja registar RECEIVED+SENT no BulkSMS Web App.
ALTER TABLE "ShopSettings" ADD COLUMN "smsCloudWebhookUrl" TEXT;
