-- Formal daily cash-up: one OPEN session per shop-local day, closed with a
-- cash count and signature. Report figures are snapshotted at close time.
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMPTZ NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "report" JSONB NOT NULL,
    "countedCash" DECIMAL(10,2),
    "countedNonCash" DECIMAL(10,2),
    "countedTotalCollected" DECIMAL(10,2),
    "cashDivergence" DECIMAL(10,2),
    "note" TEXT,
    "signatureDataUrl" TEXT,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMPTZ,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_sessions_status_idx" ON "cash_sessions"("status");
CREATE INDEX "cash_sessions_day_idx" ON "cash_sessions"("day");
CREATE UNIQUE INDEX "cash_sessions_day_timezone_key" ON "cash_sessions"("day", "timezone");

ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
