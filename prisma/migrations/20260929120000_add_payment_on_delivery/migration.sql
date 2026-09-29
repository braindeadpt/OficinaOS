-- Mark-at-delivery: one-click "paid on pickup".
-- Method chosen at marking time (null = not marked); payment row is only
-- created when the job reaches DELIVERED.
ALTER TABLE "jobs" ADD COLUMN "paymentOnDeliveryMethod" TEXT;
