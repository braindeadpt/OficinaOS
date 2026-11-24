-- The ai-inbox records deliveries with RECEIVED/SENT/FAILED, but the
-- original check constraint (20261108) only allowed CAPTURED/DRAFT —
-- every inbox write hit 23514 in production. Widen the constraint:
-- manual states stay, inbox states are added.
ALTER TABLE "business_messages"
  DROP CONSTRAINT "business_messages_capture_status_check";

ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_capture_status_check"
  CHECK ("deliveryStatus" IN ('CAPTURED', 'DRAFT', 'RECEIVED', 'SENT', 'FAILED'));
