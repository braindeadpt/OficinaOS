import { z } from "zod";
import { opaqueIdSchema } from "./id.schema";

export const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  starred: z.boolean().optional(),
});

export const bulkDeleteConversationsSchema = z.object({
  ids: z.array(opaqueIdSchema).min(1).max(50),
});

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(10_000),
  language: z.string().min(2).max(5).optional(),
  conversationId: opaqueIdSchema.nullable().optional(),
  agentName: z.string().min(1).max(100).optional(),
});

export const updateMessageSchema = z.object({
  pinned: z.boolean().optional(),
  feedback: z.enum(["THUMBS_UP", "THUMBS_DOWN"]).nullable().optional(),
});

export const listQuerySchema = z.object({
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const messagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const agentDefinitionCreateSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  instructions: z.string().max(50_000).default(""),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  toolNames: z.array(z.string()).default([]),
  handoffKeywords: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  enabledHostedTools: z.array(z.string()).default([]),
  vectorStoreId: z.string().optional(),
});

export const agentDefinitionUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(200).optional(),
  instructions: z.string().max(50_000).optional(),
  model: z.string().max(100).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  toolNames: z.array(z.string()).optional(),
  handoffKeywords: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  enabledHostedTools: z.array(z.string()).optional(),
  vectorStoreId: z.string().nullable().optional(),
});

export const aiMemorySchema = z.object({
  content: z.string().min(1).max(10_000),
  tags: z.array(z.string()).default([]),
});

export const aiInstructionSchema = z.object({
  content: z.string().min(1).max(10_000),
  tags: z.array(z.string()).default([]),
});

export const exportQuerySchema = z.object({
  format: z.enum(["text", "json"]).default("text"),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type BulkDeleteConversationsInput = z.infer<
  typeof bulkDeleteConversationsSchema
>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
export type MessagesQueryInput = z.infer<typeof messagesQuerySchema>;
export type AgentDefinitionCreateInput = z.infer<
  typeof agentDefinitionCreateSchema
>;
export type AgentDefinitionUpdateInput = z.infer<
  typeof agentDefinitionUpdateSchema
>;
export type AiMemoryInput = z.infer<typeof aiMemorySchema>;
export type AiInstructionInput = z.infer<typeof aiInstructionSchema>;
export type ExportQueryInput = z.infer<typeof exportQuerySchema>;
