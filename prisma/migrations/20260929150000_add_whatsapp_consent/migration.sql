-- WhatsApp marketing/status consent per customer. Messages are only
-- queued/sent for customers with consent granted; the timestamp records
-- when it was given (for GDPR-style audits).
ALTER TABLE "customers" ADD COLUMN "whatsappConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "whatsappConsentAt" TIMESTAMPTZ;
