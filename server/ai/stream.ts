const CHAT_COMPLETIONS_SUFFIX = /\/chat\/completions\/?$/;

import type { AiSettings, Prisma, PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import OpenAI from "openai";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { assembleSystemPrompt, getToolDefinitions } from "./context.js";
import {
  type AccumulatedToolCall,
  accumulateToolDelta,
} from "./tool-call-stream.js";
import { executeGetSchema, executeQueryDatabase } from "./tools.js";

interface StreamParams {
  agentName?: string;
  conversationId?: string;
  language?: string;
  message: string;
  prisma: PrismaClient;
  settings: AiSettings;
  userId: string;
}

interface ResolvedAgent {
  model: string | null;
  temperature: number | null;
}

interface StreamResult {
  conversationId: string;
  stream: ReadableStream<Uint8Array>;
}

function resolveApiKey(settings: AiSettings): string {
  if (!settings.apiKeyEncrypted) {
    return "";
  }
  if (isEncrypted(settings.apiKeyEncrypted)) {
    return decryptSecret(settings.apiKeyEncrypted);
  }
  return settings.apiKeyEncrypted;
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function emitContent(
  content: string,
  agentName: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): string {
  controller.enqueue(
    encoder.encode(
      sseEvent({
        type: "content",
        delta: content,
        agentName,
      })
    )
  );
  return content;
}

async function processStreamResponse(
  response: AsyncIterable<OpenAI.ChatCompletionChunk>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  agentName: string
): Promise<{ assistantContent: string; toolCalls: AccumulatedToolCall[] }> {
  let assistantContent = "";
  const toolCalls = new Map<number, AccumulatedToolCall>();

  for await (const chunk of response) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) {
      continue;
    }

    if (delta.content) {
      assistantContent += emitContent(
        delta.content,
        agentName,
        controller,
        encoder
      );
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (accumulateToolDelta(toolCalls, tc)) {
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "tool_call",
                tool: tc.function?.name,
                status: "running",
              })
            )
          );
        }
      }
    }
  }

  return {
    assistantContent,
    toolCalls: [...toolCalls.values()],
  };
}

async function executeToolCalls(
  prisma: PrismaClient,
  toolCalls: AccumulatedToolCall[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<{ followUpMessages: OpenAI.ChatCompletionMessageParam[] }> {
  const followUpMessages: OpenAI.ChatCompletionMessageParam[] = [];

  for (const tc of toolCalls) {
    const args = JSON.parse(tc.function.arguments || "{}");
    let result: string;

    if (tc.function.name === "queryDatabase") {
      result = (await executeQueryDatabase(prisma, args.sql)).data;
    } else if (tc.function.name === "getSchema") {
      result = (await executeGetSchema(prisma, args.tableName)).data;
    } else {
      result = `Unknown tool: ${tc.function.name}`;
    }

    followUpMessages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: result,
    });

    controller.enqueue(
      encoder.encode(
        sseEvent({
          type: "tool_call",
          tool: tc.function.name,
          status: "completed",
          result: result.slice(0, 200),
        })
      )
    );
  }

  return { followUpMessages };
}

export async function streamChat(params: StreamParams): Promise<StreamResult> {
  const { prisma, settings, userId, message, conversationId, agentName } =
    params;

  const apiKey = resolveApiKey(settings);
  if (!(apiKey && settings.endpointUrl)) {
    throw new AppError("AI_NOT_CONFIGURED");
  }

  const resolvedAgentName = agentName ?? "general_assistant";

  const agentDef = await prisma.aiAgentDefinition.findFirst({
    where: { name: resolvedAgentName, isActive: true },
    select: { model: true, temperature: true },
  });
  const resolvedAgent: ResolvedAgent = {
    model: agentDef?.model ?? null,
    temperature: agentDef?.temperature ?? null,
  };

  let resolvedConversationId = conversationId;
  if (resolvedConversationId) {
    // A caller-supplied conversation must belong to them — otherwise a user
    // could read or inject messages into someone else's AI history.
    const owned = await prisma.aiConversation.findFirst({
      where: { id: resolvedConversationId, userId },
      select: { id: true },
    });
    if (!owned) {
      throw new AppError("CONVERSATION_NOT_FOUND");
    }
  } else {
    const conv = await prisma.aiConversation.create({
      data: { userId },
    });
    resolvedConversationId = conv.id;
  }

  await prisma.aiMessage.create({
    data: {
      conversationId: resolvedConversationId,
      role: "USER",
      content: message,
    },
  });

  const recentMessages = await prisma.aiMessage.findMany({
    where: { conversationId: resolvedConversationId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { role: true, content: true },
  });
  const previousMessages = [...recentMessages].reverse();

  const systemPrompt = await assembleSystemPrompt(prisma, resolvedAgentName);
  const tools = getToolDefinitions();

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...previousMessages.map((m) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
  ];

  const client = new OpenAI({
    apiKey,
    baseURL: settings.endpointUrl.replace(CHAT_COMPLETIONS_SUFFIX, ""),
    timeout: 60_000,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await handleStreamCycle(
          client,
          prisma,
          settings,
          openaiMessages,
          tools,
          resolvedAgentName,
          resolvedConversationId,
          conversationId,
          message,
          controller,
          encoder,
          resolvedAgent
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Stream error";
        controller.enqueue(
          encoder.encode(
            sseEvent({
              type: "error",
              message: errorMessage,
              errorType: "streamError",
            })
          )
        );
        controller.close();
      }
    },
  });

  return {
    conversationId: resolvedConversationId,
    stream,
  };
}

async function handleStreamCycle(
  client: OpenAI,
  prisma: PrismaClient,
  settings: AiSettings,
  openaiMessages: OpenAI.ChatCompletionMessageParam[],
  tools: ReturnType<typeof getToolDefinitions>,
  agentName: string,
  conversationId: string,
  originalConversationId: string | undefined,
  userMessage: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  resolvedAgent: ResolvedAgent
) {
  const response = await client.chat.completions.create({
    model: resolvedAgent.model ?? settings.model ?? "gpt-4o",
    messages: openaiMessages,
    tools,
    temperature: resolvedAgent.temperature ?? settings.temperature ?? 0.7,
    stream: true,
  });

  const { assistantContent, toolCalls } = await processStreamResponse(
    response,
    controller,
    encoder,
    agentName
  );

  let finalContent = assistantContent;

  if (toolCalls.length > 0) {
    finalContent = await handleToolCallsFollowUp(
      client,
      prisma,
      settings,
      openaiMessages,
      toolCalls,
      agentName,
      assistantContent,
      controller,
      encoder,
      resolvedAgent
    );
  }

  await prisma.aiMessage.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: finalContent,
      agentName,
      toolCalls:
        toolCalls.length > 0
          ? (toolCalls as unknown as Prisma.InputJsonValue)
          : undefined,
    },
  });

  if (!originalConversationId) {
    const titleContent = userMessage.slice(0, 80);
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { title: titleContent },
    });
    controller.enqueue(
      encoder.encode(
        sseEvent({
          type: "title",
          title: titleContent,
        })
      )
    );
  }

  controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
  controller.close();
}

async function handleToolCallsFollowUp(
  client: OpenAI,
  prisma: PrismaClient,
  settings: AiSettings,
  openaiMessages: OpenAI.ChatCompletionMessageParam[],
  toolCalls: AccumulatedToolCall[],
  agentName: string,
  assistantContent: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  resolvedAgent: ResolvedAgent
): Promise<string> {
  const assistantMessage: OpenAI.ChatCompletionMessageParam = {
    role: "assistant",
    content: assistantContent || null,
    tool_calls: toolCalls.map((call) => ({
      ...call,
      type: "function" as const,
    })),
  };

  const { followUpMessages } = await executeToolCalls(
    prisma,
    toolCalls,
    controller,
    encoder
  );

  const allMessages: OpenAI.ChatCompletionMessageParam[] = [
    ...openaiMessages,
    assistantMessage,
    ...followUpMessages,
  ];

  const followUp = await client.chat.completions.create({
    model: resolvedAgent.model ?? settings.model ?? "gpt-4o",
    messages: allMessages,
    temperature: resolvedAgent.temperature ?? settings.temperature ?? 0.7,
    stream: true,
  });

  const { assistantContent: followUpContent } = await processStreamResponse(
    followUp,
    controller,
    encoder,
    agentName
  );

  return assistantContent + followUpContent;
}
