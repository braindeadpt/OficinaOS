-- Módulo "ai-inbox" (§G): caixa de entrada unificada. Conversas por
-- (canal + telefone) com estado mutável próprio; mensagens BusinessMessage
-- ganham a ligação à conversa, quem tratou e leitura staff. Rascunhos de
-- resposta com aprovação humana em dois passos (§G.5) e a opção
-- por-utilizador "permitir envio direto pelo MCP" (off por defeito).

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'INBOX_TOOL_CALL';
ALTER TYPE "AuditAction" ADD VALUE 'INBOX_MESSAGE_SENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "mcpDirectSend" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN "inboxRetentionDays" INTEGER NOT NULL DEFAULT 365;

-- AlterTable — mensagens gravadas pela app (inbound/outbound) não têm um
-- utilizador criador: a coluna passa a admitir NULL.
ALTER TABLE "business_messages" ALTER COLUMN "createdById" DROP NOT NULL,
ADD COLUMN "conversationKey" TEXT,
ADD COLUMN "conversationId" TEXT,
ADD COLUMN "handledBy" TEXT,
ADD COLUMN "readAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "inbox_conversations" (
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
CREATE TABLE "inbox_drafts" (
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
CREATE UNIQUE INDEX "inbox_conversations_conversationKey_key" ON "inbox_conversations"("conversationKey");
CREATE INDEX "inbox_conversations_status_lastMessageAt_idx" ON "inbox_conversations"("status", "lastMessageAt");
CREATE INDEX "inbox_conversations_assignedToId_idx" ON "inbox_conversations"("assignedToId");
CREATE INDEX "inbox_conversations_channel_lastMessageAt_idx" ON "inbox_conversations"("channel", "lastMessageAt");
CREATE INDEX "inbox_drafts_conversationId_createdAt_idx" ON "inbox_drafts"("conversationId", "createdAt");
CREATE INDEX "inbox_drafts_status_idx" ON "inbox_drafts"("status");
CREATE INDEX "business_messages_conversationId_receivedAt_idx" ON "business_messages"("conversationId", "receivedAt");
-- Dedup idempotente por id estável do canal: o índice único
-- "business_messages_channel_externalId_key" já existe (migração base).

-- AddForeignKey
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "inbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_drafts" ADD CONSTRAINT "inbox_drafts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "business_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_messages" ADD CONSTRAINT "business_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "inbox_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
