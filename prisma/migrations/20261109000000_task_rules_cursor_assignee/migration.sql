-- task_rules: reconcile cursor + real FK on assigneeId.
-- Previously a bare string — deleting the user left a dangling id.
ALTER TABLE "task_rules" ADD COLUMN "scanCursor" TEXT;

ALTER TABLE "task_rules"
  ADD CONSTRAINT "task_rules_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "task_rules_assigneeId_idx" ON "task_rules"("assigneeId");
