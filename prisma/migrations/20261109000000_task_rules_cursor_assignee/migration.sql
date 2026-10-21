-- task_rules: reconcile cursor + real FK on assigneeId.
-- Previously a bare string — deleting the user left a dangling id.
ALTER TABLE "task_rules" ADD COLUMN "scanCursor" TEXT;

-- Clean dangling ids first — installs that already ran the #85 rules
-- may hold assigneeId values pointing at users deleted since, and the
-- FK below would fail on them.
UPDATE "task_rules"
SET "assigneeId" = NULL
WHERE "assigneeId" IS NOT NULL
  AND "assigneeId" NOT IN (SELECT "id" FROM "users");

ALTER TABLE "task_rules"
  ADD CONSTRAINT "task_rules_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "task_rules_assigneeId_idx" ON "task_rules"("assigneeId");
