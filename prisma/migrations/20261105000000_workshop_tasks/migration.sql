ALTER TYPE "PhotoStage" ADD VALUE 'INTAKE';
ALTER TYPE "PhotoStage" ADD VALUE 'REPAIR';
ALTER TYPE "PhotoStage" ADD VALUE 'FINAL';

-- AlterTable
ALTER TABLE "supplier_rmas" ADD COLUMN     "jobId" TEXT;

-- CreateTable
CREATE TABLE "workshop_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "jobId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "nextTitle" TEXT,
    "nextDelayHours" INTEGER NOT NULL DEFAULT 0,
    "predecessorId" TEXT,
    "triggerKey" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_rules" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "triggerStatus" "JobStatus" NOT NULL,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "nextTitle" TEXT,
    "nextDelayHours" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workshop_tasks_predecessorId_key" ON "workshop_tasks"("predecessorId");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_tasks_triggerKey_key" ON "workshop_tasks"("triggerKey");

-- CreateIndex
CREATE INDEX "workshop_tasks_jobId_idx" ON "workshop_tasks"("jobId");

-- CreateIndex
CREATE INDEX "workshop_tasks_completedAt_scheduledAt_idx" ON "workshop_tasks"("completedAt", "scheduledAt");

-- CreateIndex
CREATE INDEX "supplier_rmas_jobId_idx" ON "supplier_rmas"("jobId");

-- AddForeignKey
ALTER TABLE "supplier_rmas" ADD CONSTRAINT "supplier_rmas_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_rules" ADD CONSTRAINT "task_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

