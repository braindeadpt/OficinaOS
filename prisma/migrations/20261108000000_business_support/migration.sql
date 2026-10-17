-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "costGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "costVatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
ADD COLUMN     "partId" TEXT,
ADD COLUMN     "purchaseUrl" TEXT,
ADD COLUMN     "quoteGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recoverInputVat" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "saleVatRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT 'OTHER',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "customerId" TEXT,
    "supplierId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_messages" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "deliveryStatus" TEXT NOT NULL DEFAULT 'CAPTURED',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "correspondent" TEXT,
    "externalId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "createdById" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_message_links" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "business_message_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_agreements" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "amountGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commissionBasisNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "paidGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interval" TEXT NOT NULL DEFAULT 'ONCE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reference" TEXT,
    "startsAt" TIMESTAMPTZ,
    "renewsAt" TIMESTAMPTZ,
    "endsAt" TIMESTAMPTZ,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commercial_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_customerId_idx" ON "support_tickets"("customerId");

-- CreateIndex
CREATE INDEX "support_tickets_supplierId_idx" ON "support_tickets"("supplierId");

-- CreateIndex
CREATE INDEX "business_messages_customerId_receivedAt_idx" ON "business_messages"("customerId", "receivedAt");

-- CreateIndex
CREATE INDEX "business_messages_supplierId_receivedAt_idx" ON "business_messages"("supplierId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_messages_channel_externalId_key" ON "business_messages"("channel", "externalId");

-- CreateIndex
CREATE INDEX "business_message_links_entityType_entityId_idx" ON "business_message_links"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "business_message_links_messageId_entityType_entityId_key" ON "business_message_links"("messageId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "commercial_agreements_customerId_idx" ON "commercial_agreements"("customerId");

-- CreateIndex
CREATE INDEX "commercial_agreements_supplierId_idx" ON "commercial_agreements"("supplierId");

-- CreateIndex
CREATE INDEX "commercial_agreements_renewsAt_idx" ON "commercial_agreements"("renewsAt");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_customerId_key" ON "suppliers"("customerId");

-- CreateIndex
CREATE INDEX "purchase_orders_customerId_idx" ON "purchase_orders"("customerId");

-- CreateIndex
CREATE INDEX "purchase_orders_jobId_idx" ON "purchase_orders"("jobId");

-- CreateIndex
CREATE INDEX "purchase_orders_partId_idx" ON "purchase_orders"("partId");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_message_links" ADD CONSTRAINT "business_message_links_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "business_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_agreements" ADD CONSTRAINT "commercial_agreements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_agreements" ADD CONSTRAINT "commercial_agreements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Monetary values and rates remain valid even when written outside the API.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_money_check" CHECK (
  "costGross" >= 0 AND "quoteGross" >= 0 AND "costVatRate" BETWEEN 0 AND 100
  AND "saleVatRate" BETWEEN 0 AND 100 AND "kind" IN ('PRODUCT', 'PART')
  AND ("partId" IS NULL OR "kind" = 'PART')
);
ALTER TABLE "commercial_agreements" ADD CONSTRAINT "commercial_agreements_money_check" CHECK (
  "amountGross" >= 0 AND "paidGross" >= 0 AND "commissionBasisNet" >= 0
  AND "vatRate" BETWEEN 0 AND 100 AND "commissionRate" BETWEEN 0 AND 100
  AND ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" >= "startsAt")
);
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_capture_status_check"
  CHECK ("deliveryStatus" IN ('CAPTURED', 'DRAFT'));
