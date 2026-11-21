-- CreateEnum
CREATE TYPE "ExternalRepairKind" AS ENUM ('WARRANTY', 'REPAIRER');

-- CreateEnum
CREATE TYPE "ExternalRepairStatus" AS ENUM ('SENT', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "external_repairs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "ExternalRepairKind" NOT NULL DEFAULT 'REPAIRER',
    "status" "ExternalRepairStatus" NOT NULL DEFAULT 'SENT',
    "reference" TEXT,
    "notes" TEXT,
    "expectedReturnAt" TIMESTAMPTZ,
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMPTZ,
    "costFinal" DECIMAL(12,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "external_repairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_repairs_jobId_idx" ON "external_repairs"("jobId");

-- CreateIndex
CREATE INDEX "external_repairs_supplierId_idx" ON "external_repairs"("supplierId");

-- CreateIndex
CREATE INDEX "external_repairs_status_idx" ON "external_repairs"("status");

-- CreateIndex
CREATE INDEX "external_repairs_createdById_idx" ON "external_repairs"("createdById");

-- AddForeignKey
ALTER TABLE "external_repairs" ADD CONSTRAINT "external_repairs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_repairs" ADD CONSTRAINT "external_repairs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_repairs" ADD CONSTRAINT "external_repairs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
