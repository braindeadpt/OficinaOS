-- Suppliers, supplier RMAs and job referrals (encaminhar para outra loja).

CREATE TYPE "SupplierRmaStatus" AS ENUM ('OPEN', 'SENT', 'RECEIVED', 'RESOLVED', 'CANCELLED');
CREATE TYPE "ReferralStatus" AS ENUM ('SENT', 'ACCEPTED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_rmas" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "partId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "SupplierRmaStatus" NOT NULL DEFAULT 'OPEN',
    "reference" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMPTZ,
    "resolvedAt" TIMESTAMPTZ,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "supplier_rmas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_referrals" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "toShopName" TEXT NOT NULL,
    "toShopContact" TEXT,
    "reason" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'SENT',
    "notes" TEXT,
    "resolvedAt" TIMESTAMPTZ,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "job_referrals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");
CREATE INDEX "supplier_rmas_supplierId_idx" ON "supplier_rmas"("supplierId");
CREATE INDEX "supplier_rmas_status_idx" ON "supplier_rmas"("status");
CREATE INDEX "supplier_rmas_createdAt_idx" ON "supplier_rmas"("createdAt");
CREATE INDEX "job_referrals_jobId_idx" ON "job_referrals"("jobId");
CREATE INDEX "job_referrals_status_idx" ON "job_referrals"("status");

ALTER TABLE "supplier_rmas"
    ADD CONSTRAINT "supplier_rmas_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "supplier_rmas_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "supplier_rmas_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_referrals"
    ADD CONSTRAINT "job_referrals_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "job_referrals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
