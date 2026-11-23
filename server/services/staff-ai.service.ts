import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyBaseLogger } from "fastify";
import { cloudFetch } from "./cloud.service.js";
import { runStaffInboxTool } from "./staff-inbox-tools.js";

/**
 * Porta 1 do §G — IA para o staff mediada pela Cloud.
 *
 * POST /ai/staff-reply {messages, userId} → a Cloud responde:
 *   {type:"tool_calls", calls:[{id,name,args}]}  → a app executa as
 *                                                 staffInboxTools
 *                                                 LOCALMENTE (com as
 *                                                 permissões do userId)
 *                                                 e re-envia os
 *                                                 resultados como
 *                                                 mensagens "tool";
 *   {type:"reply", reply}                        → resposta final.
 *
 * A Cloud é stateless — cada ronda leva a conversa completa. O
 * entitlement "ai-inbox" é verificado na Cloud (402 → módulo em falta)
 * e na app antes de se chegar aqui. Nada deste ficheiro toca em
 * server/ai/stream.ts — o chat de staff local fica como está.
 */

const MAX_TOOL_ROUNDS = 3;
const TOTAL_BUDGET_MS = 20_000;

interface StaffAiMessage {
  content?: string;
  name?: string;
  role: "assistant" | "tool" | "user";
  tool_call_id?: string;
  tool_calls?: { args: Record<string, unknown>; id: string; name: string }[];
}

interface StaffAiCall {
  args?: Record<string, unknown>;
  id?: unknown;
  name?: unknown;
}

function parseCalls(raw: unknown): StaffAiCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  for (const c of raw as StaffAiCall[]) {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof c.id !== "string" ||
      typeof c.name !== "string" ||
      (c.args !== undefined && (typeof c.args !== "object" || c.args === null))
    ) {
      return null;
    }
  }
  return raw as StaffAiCall[];
}

/** Corre as tool calls pedidas e regista resultados nas mensagens. */
async function runCalls(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  userId: string,
  calls: StaffAiCall[],
  messages: StaffAiMessage[]
): Promise<void> {
  messages.push({
    role: "assistant",
    tool_calls: calls.map((c) => ({
      args: (c.args ?? {}) as Record<string, unknown>,
      id: c.id as string,
      name: c.name as string,
    })),
  });
  for (const call of calls) {
    const out = await runStaffInboxTool(prisma, log, {
      args: call.args as Record<string, unknown> | undefined,
      tool: call.name as string,
      userId,
    });
    messages.push({
      content: JSON.stringify(out.result ?? { erro: out.error }),
      name: call.name as string,
      role: "tool",
      tool_call_id: call.id as string,
    });
  }
}

/**
 * Conversa staff↔IA — devolve a resposta final. Erros Cloud viram
 * AppError com o código certo (402 → módulo em falta; resto →
 * CLOUD_UNREACHABLE) para a rota interna responder consistente.
 */
/** Resposta da Cloud → reply final ou lote de tool calls (ou AppError). */
function interpretResponse(res: {
  body: unknown;
  ok: boolean;
  status: number;
}): { calls: StaffAiCall[] } | { reply: string } | null {
  if (res.status === 402 || res.status === 403) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  if (res.status === 401) {
    throw new AppError("UNAUTHORIZED");
  }
  if (!res.ok || typeof res.body !== "object" || res.body === null) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  const body = res.body as {
    calls?: unknown;
    reply?: unknown;
    type?: unknown;
  };
  if (body.type === "reply" && typeof body.reply === "string") {
    return { reply: body.reply };
  }
  const calls = body.type === "tool_calls" ? parseCalls(body.calls) : null;
  return calls ? { calls } : null;
}

/**
 * Conversa staff↔IA — devolve a resposta final. Erros Cloud viram
 * AppError com o código certo (402 → módulo em falta; resto →
 * CLOUD_UNREACHABLE) para a rota interna responder consistente.
 */
export async function askStaffAi(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  creds: { apiUrl: string; token: string },
  input: { messages: StaffAiMessage[]; userId: string }
): Promise<{ reply: string }> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const messages: StaffAiMessage[] = [...input.messages];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new AppError("CLOUD_UNREACHABLE");
    }
    const res = await cloudFetch(creds.apiUrl, "/ai/staff-reply", {
      body: { messages, userId: input.userId },
      method: "POST",
      timeoutMs: remaining,
      token: creds.token,
    }).catch(() => null);
    if (!res) {
      throw new AppError("CLOUD_UNREACHABLE");
    }
    const parsed = interpretResponse(res);
    if (parsed && "reply" in parsed) {
      return { reply: parsed.reply };
    }
    if (!parsed || round === MAX_TOOL_ROUNDS) {
      throw new AppError("CLOUD_UNREACHABLE");
    }
    await runCalls(prisma, log, input.userId, parsed.calls, messages);
  }
  throw new AppError("CLOUD_UNREACHABLE");
}
