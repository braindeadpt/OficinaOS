import { AppError } from "@shared/errors/app-error.js";
import {
  agentDefinitionCreateSchema,
  agentDefinitionUpdateSchema,
  aiInstructionSchema,
  aiMemorySchema,
  bulkDeleteConversationsSchema,
  chatMessageSchema,
  createConversationSchema,
  exportQuerySchema,
  listQuerySchema,
  messagesQuerySchema,
  updateConversationSchema,
  updateMessageSchema,
} from "@shared/schemas/ai.schema";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { getToolDefinitions } from "../ai/context.js";
import { streamChat } from "../ai/stream.js";
import { requirePermission } from "../middlewares/rbac.js";
import {
  createAgentDefinition,
  createInstruction,
  createMemory,
  deleteAgentDefinition,
  deleteInstruction,
  deleteMemory,
  getAgentDefinition,
  listAgentDefinitions,
  listInstructions,
  listMemories,
  updateAgentDefinition,
  updateInstruction,
  updateMemory,
} from "../services/ai-agent.service.js";
import {
  bulkDeleteConversations,
  createConversation,
  deleteConversation,
  deleteMessage,
  exportConversation,
  getConversation,
  listConversations,
  listMessages,
  updateConversation,
  updateMessage,
} from "../services/ai-chat.service.js";
import {
  getAiSettings,
  getRawAiSettings,
} from "../services/settings.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ ai: ["access"] }));

  async function requireAiEnabled(_req: FastifyRequest, _reply: FastifyReply) {
    const settings = await getAiSettings(app.prisma);
    if (!settings?.enabled) {
      throw new AppError("AI_DISABLED");
    }
  }

  app.get(
    "/",
    {
      schema: {
        tags: ["ai"],
        summary: "List conversations",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await listConversations(
        app.prisma,
        getUserId(req),
        parsed.data
      );
      return await reply.send(result);
    }
  );

  app.post(
    "/",
    {
      preHandler: [requireAiEnabled],
      schema: {
        tags: ["ai"],
        summary: "Create conversation",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = createConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const conversation = await createConversation(
        app.prisma,
        getUserId(req),
        parsed.data.title
      );
      return await reply.status(201).send(conversation);
    }
  );

  app.post(
    "/bulk-delete",
    {
      schema: {
        tags: ["ai"],
        summary: "Bulk delete conversations",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = bulkDeleteConversationsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await bulkDeleteConversations(
        app.prisma,
        getUserId(req),
        parsed.data
      );
      return await reply.send(result);
    }
  );

  app.post(
    "/chat/stream",
    {
      preHandler: [requireAiEnabled],
      schema: {
        tags: ["ai"],
        summary: "Stream chat message",
        body: { type: "object", additionalProperties: true },
        produces: ["text/event-stream"],
      },
    },
    async (req, reply) => {
      const parsed = chatMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const rawSettings = await getRawAiSettings(app.prisma);
      const { conversationId, stream } = await streamChat({
        agentName: parsed.data.agentName,
        conversationId: parsed.data.conversationId ?? undefined,
        language: parsed.data.language,
        message: parsed.data.message,
        prisma: app.prisma,
        settings: rawSettings as NonNullable<typeof rawSettings>,
        userId: getUserId(req),
      });
      reply.raw.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
        "X-Conversation-Id": conversationId,
        Connection: "keep-alive",
      });
      let aborted = false;
      const onClose = () => {
        aborted = true;
        reader.cancel().catch(() => {
          /* fire-and-forget */
        });
      };
      req.raw.on("close", onClose);
      const reader = stream.getReader();
      try {
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done || aborted) {
            break;
          }
          reply.raw.write(value);
        }
      } finally {
        req.raw.off("close", onClose);
        reader.releaseLock();
        reply.raw.end();
      }
    }
  );

  app.get(
    "/definitions",
    {
      schema: {
        tags: ["ai"],
        summary: "List agent definitions",
      },
    },
    async (_req, reply) => {
      const definitions = await listAgentDefinitions(app.prisma);
      return await reply.send(definitions);
    }
  );

  app.post(
    "/definitions",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Create agent definition",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = agentDefinitionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const definition = await createAgentDefinition(app.prisma, parsed.data);
      return await reply.status(201).send(definition);
    }
  );

  app.get(
    "/definitions/:defId",
    {
      schema: {
        tags: ["ai"],
        summary: "Get agent definition",
        params: {
          type: "object",
          properties: { defId: { type: "string" } },
          required: ["defId"],
        },
      },
    },
    async (req, reply) => {
      const { defId } = req.params as { defId: string };
      const definition = await getAgentDefinition(app.prisma, defId);
      if (!definition) {
        throw new AppError("AGENT_DEFINITION_NOT_FOUND");
      }
      return await reply.send(definition);
    }
  );

  app.put(
    "/definitions/:defId",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Update agent definition",
        params: {
          type: "object",
          properties: { defId: { type: "string" } },
          required: ["defId"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { defId } = req.params as { defId: string };
      const parsed = agentDefinitionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await updateAgentDefinition(
        app.prisma,
        defId,
        parsed.data
      );
      if (!updated) {
        throw new AppError("AGENT_DEFINITION_NOT_FOUND");
      }
      return await reply.send(updated);
    }
  );

  app.delete(
    "/definitions/:defId",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Delete agent definition",
        params: {
          type: "object",
          properties: { defId: { type: "string" } },
          required: ["defId"],
        },
      },
    },
    async (req, reply) => {
      const { defId } = req.params as { defId: string };
      const deleted = await deleteAgentDefinition(app.prisma, defId);
      if (!deleted) {
        throw new AppError("AGENT_DEFINITION_NOT_FOUND");
      }
      return await reply.send(deleted);
    }
  );

  app.get(
    "/instructions",
    {
      schema: {
        tags: ["ai"],
        summary: "List AI instructions",
      },
    },
    async (_req, reply) => {
      const instructions = await listInstructions(app.prisma);
      return await reply.send(instructions);
    }
  );

  app.post(
    "/instructions",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Create AI instruction",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = aiInstructionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const instruction = await createInstruction(app.prisma, parsed.data);
      return await reply.status(201).send(instruction);
    }
  );

  app.put(
    "/instructions/:instId",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Update AI instruction",
        params: {
          type: "object",
          properties: { instId: { type: "string" } },
          required: ["instId"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { instId } = req.params as { instId: string };
      const parsed = aiInstructionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await updateInstruction(app.prisma, instId, parsed.data);
      if (!updated) {
        throw new AppError("INSTRUCTION_NOT_FOUND");
      }
      return await reply.send(updated);
    }
  );

  app.delete(
    "/instructions/:instId",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Delete AI instruction",
        params: {
          type: "object",
          properties: { instId: { type: "string" } },
          required: ["instId"],
        },
      },
    },
    async (req, reply) => {
      const { instId } = req.params as { instId: string };
      const deleted = await deleteInstruction(app.prisma, instId);
      if (!deleted) {
        throw new AppError("INSTRUCTION_NOT_FOUND");
      }
      return await reply.send(deleted);
    }
  );

  app.get(
    "/memories",
    {
      schema: {
        tags: ["ai"],
        summary: "List AI memories",
      },
    },
    async (_req, reply) => {
      const memories = await listMemories(app.prisma);
      return await reply.send(memories);
    }
  );

  app.post(
    "/memories",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Create AI memory",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = aiMemorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const memory = await createMemory(app.prisma, parsed.data);
      return await reply.status(201).send(memory);
    }
  );

  app.put(
    "/memories/:memId",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Update AI memory",
        params: {
          type: "object",
          properties: { memId: { type: "string" } },
          required: ["memId"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { memId } = req.params as { memId: string };
      const parsed = aiMemorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await updateMemory(app.prisma, memId, parsed.data);
      if (!updated) {
        throw new AppError("MEMORY_NOT_FOUND");
      }
      return await reply.send(updated);
    }
  );

  app.delete(
    "/memories/:memId",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["ai"],
        summary: "Delete AI memory",
        params: {
          type: "object",
          properties: { memId: { type: "string" } },
          required: ["memId"],
        },
      },
    },
    async (req, reply) => {
      const { memId } = req.params as { memId: string };
      const deleted = await deleteMemory(app.prisma, memId);
      if (!deleted) {
        throw new AppError("MEMORY_NOT_FOUND");
      }
      return await reply.send(deleted);
    }
  );

  app.get(
    "/tools/available",
    {
      schema: {
        tags: ["ai"],
        summary: "List available AI tools",
      },
    },
    async (_req, reply) => {
      const tools = getToolDefinitions();
      return await reply.send(tools);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["ai"],
        summary: "Get conversation",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const conversation = await getConversation(
        app.prisma,
        getUserId(req),
        id
      );
      if (!conversation) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      return await reply.send(conversation);
    }
  );

  app.put(
    "/:id",
    {
      schema: {
        tags: ["ai"],
        summary: "Update conversation",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await updateConversation(
        app.prisma,
        getUserId(req),
        id,
        parsed.data
      );
      if (!updated) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      return await reply.send(updated);
    }
  );

  app.delete(
    "/:id",
    {
      schema: {
        tags: ["ai"],
        summary: "Delete conversation",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await deleteConversation(app.prisma, getUserId(req), id);
      if (!deleted) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      return await reply.send(deleted);
    }
  );

  app.get(
    "/:id/export",
    {
      schema: {
        tags: ["ai"],
        summary: "Export conversation",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = exportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const conversation = await exportConversation(
        app.prisma,
        getUserId(req),
        id
      );
      if (!conversation) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      if (parsed.data.format === "json") {
        return await reply.send(conversation);
      }
      const text = formatConversationText(
        conversation as unknown as ExportedConversation
      );
      return await reply.type("text/plain").send(text);
    }
  );

  app.get(
    "/:id/messages",
    {
      schema: {
        tags: ["ai"],
        summary: "List conversation messages",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = messagesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await listMessages(
        app.prisma,
        getUserId(req),
        id,
        parsed.data
      );
      if (!result) {
        throw new AppError("CONVERSATION_NOT_FOUND");
      }
      return await reply.send(result);
    }
  );

  app.put(
    "/:id/messages/:messageId",
    {
      schema: {
        tags: ["ai"],
        summary: "Update message",
        params: {
          type: "object",
          properties: { id: { type: "string" }, messageId: { type: "string" } },
          required: ["id", "messageId"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id, messageId } = req.params as { id: string; messageId: string };
      const parsed = updateMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await updateMessage(
        app.prisma,
        getUserId(req),
        id,
        messageId,
        parsed.data
      );
      if (!updated) {
        throw new AppError("MESSAGE_NOT_FOUND");
      }
      return await reply.send(updated);
    }
  );

  app.delete(
    "/:id/messages/:messageId",
    {
      schema: {
        tags: ["ai"],
        summary: "Delete message",
        params: {
          type: "object",
          properties: { id: { type: "string" }, messageId: { type: "string" } },
          required: ["id", "messageId"],
        },
      },
    },
    async (req, reply) => {
      const { id, messageId } = req.params as { id: string; messageId: string };
      const deleted = await deleteMessage(
        app.prisma,
        getUserId(req),
        id,
        messageId
      );
      if (!deleted) {
        throw new AppError("MESSAGE_NOT_FOUND");
      }
      return await reply.send(deleted);
    }
  );
};

interface ExportedConversation {
  messages: Array<{ content: string; createdAt: Date; role: string }>;
  title: string | null;
}

function formatConversationText(conversation: ExportedConversation): string {
  const parts: string[] = [];
  if (conversation.title) {
    parts.push(`# ${conversation.title}`);
    parts.push("");
  }
  for (const msg of conversation.messages) {
    const role = msg.role === "USER" ? "You" : "AI";
    parts.push(`[${role}]`);
    parts.push(msg.content);
    parts.push("");
  }
  return parts.join("\n");
}
