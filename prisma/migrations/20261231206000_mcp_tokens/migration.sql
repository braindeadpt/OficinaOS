-- MCP read-only personal tokens (issue #74). Additive only.

ALTER TYPE "AuditAction" ADD VALUE 'MCP_READ';

CREATE TABLE "mcp_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "showPii" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ,
    "lastUsedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_tokens_tokenHash_key" ON "mcp_tokens"("tokenHash");
CREATE INDEX "mcp_tokens_userId_idx" ON "mcp_tokens"("userId");

ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
