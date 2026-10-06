-- Portuguese counters are paid mostly by MB WAY and Multibanco reference;
-- recording them as "OTHER"/"TRANSFER" hid them from the cash report.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MB_WAY';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MULTIBANCO';
