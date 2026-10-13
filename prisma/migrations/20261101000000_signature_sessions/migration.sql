-- Remote intake signature relay — the customer signs on their own phone via
-- /sign/{token}; the intake modal polls until the signature lands and stores
-- it on the job. Sessions expire quickly and carry no job/customer data.
CREATE TABLE "signature_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "signatureDataUrl" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "signature_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signature_sessions_token_key" ON "signature_sessions"("token");
