-- Módulo "ai-inbox" (§G): caixa de entrada unificada. Conversas por
-- (canal + telefone) com estado mutável próprio; mensagens BusinessMessage
-- ganham a ligação à conversa, quem tratou e leitura staff. Rascunhos de
-- resposta com aprovação humana em dois passos (§G.5) e a opção
-- por-utilizador "permitir envio direto pelo MCP" (off por defeito).
--
-- IDEMPOTENTE por desenho: esta pasta foi renomeada de
-- 20261228000000_ai_inbox — bases de teste persistentes que já aplicaram
-- o mesmo SQL sob o nome antigo correm-na outra vez (o Prisma identifica
-- a migração pelo nome da pasta). Cada operação tolera "já existe":
-- enum values via pg_enum, colunas/índices/tabelas via IF NOT EXISTS e
-- FKs via pg_constraint.

-- AlterEnum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'INBOX_TOOL_CALL'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'INBOX_TOOL_CALL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'INBOX_MESSAGE_SENT'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'INBOX_MESSAGE_SENT';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mcpDirectSend" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN IF NOT EXISTS "inboxRetentionDays" INTEGER NOT NULL DEFAULT 365;

-- AlterTable — mensagens gravadas pela app (inbound/outbound) não têm um
-- utilizador criador: a coluna passa a admitir NULL (DROP NOT NULL é
-- no-op se já for nullable; as colunas novas toleram existir).
ALTER TABLE "business_messages" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "business_messages"
ADD COLUMN IF NOT EXISTS "conversationKey" TEXT,
ADD COLUMN IF NOT EXISTS "conversationId" TEXT,
ADD COLUMN IF NOT EXISTS "handledBy" TEXT,
ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE IF NOT EXISTS "inbox_conversations" (
    "id" TEXT NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "escalatedAt" TIMESTAMPTZ,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMPTZ NOT NULL,
    "lastInboundAt" TIMESTAMPTZ,
    "lastOutboundAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inbox_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inbox_drafts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ,
    "sentAt" TIMESTAMPTZ,
    "error" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inbox_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_conversations_conversationKey_key" ON "inbox_conversations"("conversationKey");
CREATE INDEX IF NOT EXISTS "inbox_conversations_status_lastMessageAt_idx" ON "inbox_conversations"("status", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "inbox_conversations_assignedToId_idx" ON "inbox_conversations"("assignedToId");
CREATE INDEX IF NOT EXISTS "inbox_conversations_channel_lastMessageAt_idx" ON "inbox_conversations"("channel", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "inbox_drafts_conversationId_createdAt_idx" ON "inbox_drafts"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "inbox_drafts_status_idx" ON "inbox_drafts"("status");
CREATE INDEX IF NOT EXISTS "business_messages_conversationId_receivedAt_idx" ON "business_messages"("conversationId", "receivedAt");
-- Dedup idempotente por id estável do canal: o índice único
-- "business_messages_channel_externalId_key" já existe (migração base).

-- AddForeignKey — pg_constraint não tem IF NOT EXISTS: salta os que já
-- existam (base que correu a versão com o nome antigo).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_conversations_customerId_fkey' AND conrelid = 'inbox_conversations'::regclass) THEN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_conversations_assignedToId_fkey' AND conrelid = 'inbox_conversations'::regclass) THEN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_drafts_conversationId_fkey' AND conrelid = 'inbox_drafts'::regclass) THEN
    ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "inbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_drafts_createdById_fkey' AND conrelid = 'inbox_drafts'::regclass) THEN
    ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_drafts_approvedById_fkey' AND conrelid = 'inbox_drafts'::regclass) THEN
    ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_drafts_messageId_fkey' AND conrelid = 'inbox_drafts'::regclass) THEN
    ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "business_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_messages_conversationId_fkey' AND conrelid = 'business_messages'::regclass) THEN
    ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "inbox_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
