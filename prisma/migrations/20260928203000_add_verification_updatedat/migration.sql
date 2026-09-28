-- Better Auth >=1.7 expects verification.updatedAt
ALTER TABLE "verifications" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
