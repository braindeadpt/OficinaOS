-- 2FA TOTP (Better Auth `twoFactor` plugin)
--
-- users.twoFactorEnabled espelha o estado final de enrolment;
-- two_factors guarda o segredo e os backup codes encriptados pelo plugin.

ALTER TABLE "users" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "two_factors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ,

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factors_userId_key" ON "two_factors"("userId");

ALTER TABLE "two_factors"
    ADD CONSTRAINT "two_factors_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
