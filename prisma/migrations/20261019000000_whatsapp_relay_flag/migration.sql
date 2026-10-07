-- WhatsApp relay: once the cloud accepts the shop's Meta credentials,
-- outbound sends go through POST /whatsapp/send (entitlement enforced
-- server-side) and the local token is cleared after the first success.
ALTER TABLE "ShopSettings" ADD COLUMN "whatsappCredentialsAtCloud" BOOLEAN NOT NULL DEFAULT false;
