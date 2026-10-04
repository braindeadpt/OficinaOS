CREATE TYPE "TradeInStatus" AS ENUM ('OFFERED', 'PURCHASED', 'CANCELLED', 'SOLD');
CREATE TYPE "TradeInCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR');
CREATE TYPE "TradeInPaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'STORE_CREDIT');

CREATE TABLE "trade_in_counters" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "trade_in_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "trade_ins" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerIdType" TEXT NOT NULL,
    "sellerIdNumber" TEXT NOT NULL,
    "deviceBrand" TEXT NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "imei" TEXT,
    "storage" TEXT,
    "condition" "TradeInCondition" NOT NULL,
    "functionalChecklist" JSONB,
    "notes" TEXT,
    "purchasePrice" DECIMAL(10,2) NOT NULL,
    "paymentMethod" "TradeInPaymentMethod" NOT NULL,
    "status" "TradeInStatus" NOT NULL DEFAULT 'OFFERED',
    "signatureDataUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "trade_ins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_ins_code_key" ON "trade_ins"("code");
CREATE INDEX "trade_ins_status_createdAt_idx" ON "trade_ins"("status", "createdAt");

ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
