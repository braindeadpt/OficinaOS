-- AlterTable
ALTER TABLE "workshop_tasks" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "task_rules" ADD COLUMN     "workflowStateId" TEXT,
ALTER COLUMN "triggerStatus" DROP NOT NULL;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "supplierId" TEXT,
    "notes" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_states" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_workflows" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "record_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_states_entityType_name_key" ON "workflow_states"("entityType", "name");

-- CreateIndex
CREATE UNIQUE INDEX "record_workflows_entityType_entityId_key" ON "record_workflows"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "workshop_tasks_entityType_entityId_idx" ON "workshop_tasks"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "task_rules" ADD CONSTRAINT "task_rules_workflowStateId_fkey" FOREIGN KEY ("workflowStateId") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_workflows" ADD CONSTRAINT "record_workflows_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve associations of tasks created before multi-module tasks.
UPDATE "workshop_tasks" SET "entityType" = 'JOB', "entityId" = "jobId" WHERE "jobId" IS NOT NULL;

ALTER TABLE "task_rules" ADD CONSTRAINT "task_rules_one_trigger" CHECK (("triggerStatus" IS NOT NULL) <> ("workflowStateId" IS NOT NULL));
