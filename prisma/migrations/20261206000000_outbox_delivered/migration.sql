-- DELIVERED: estado terminal positivo escrito pelos delivery reports do
-- transporte cloud (BulkSMS status-report → refId = outbox entry id).
ALTER TYPE "OutboxStatus" ADD VALUE 'DELIVERED';
