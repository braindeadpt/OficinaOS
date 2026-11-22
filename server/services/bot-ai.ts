import type { BotToolCtx } from "./bot-tools.js";
import { runBotTool } from "./bot-tools.js";
import { cloudFetch } from "./cloud.service.js";

/**
 * askBotAi() — envia a conversa para a Cloud (POST /ai/bot-reply) e executa
 * localmente as ferramentas que ela pedir. A Cloud é stateless: cada ronda
 * leva a conversa completa. Limites do plano (§E.5):
 *   - máx. 3 rondas de ferramentas;
 *   - 15 s no total (depois → fallback determinístico);
 *   - resposta ou erro inválido → null → regras determinísticas respondem.
 * A Cloud nunca executa ferramentas — pede, a app corre, o resultado volta.
 */

const MAX_TOOL_ROUNDS = 3;
const TOTAL_BUDGET_MS = 15_000;
const MAX_REPLY_LEN = 4000;

interface BotAiMessage {
  content?: string;
  name?: string;
  role: "user" | "assistant" | "tool";
  tool_call_id?: string;
  tool_calls?: { args: Record<string, unknown>; id: string; name: string }[];
}

interface BotAiCall {
  args?: Record<string, unknown>;
  id?: unknown;
  name?: unknown;
}

export interface BotAiInput {
  channel: "sms" | "whatsapp" | "evolution";
  phone: string;
  userText: string;
}

export interface BotAiResult {
  escalate: boolean;
  reply: string;
}

function parseCalls(raw: unknown): BotAiCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  for (const c of raw as BotAiCall[]) {
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
  return raw as BotAiCall[];
}

export async function askBotAi(
  ctx: BotToolCtx,
  cloud: { apiUrl: string; token: string },
  input: BotAiInput
): Promise<BotAiResult | null> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const messages: BotAiMessage[] = [{ content: input.userText, role: "user" }];
  let escalate = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return null;
    }
    const res = await cloudFetch(cloud.apiUrl, "/ai/bot-reply", {
      body: {
        channel: input.channel,
        messages,
        shopCard: ctx.shopCard,
      },
      method: "POST",
      timeoutMs: remaining,
      token: cloud.token,
    }).catch(() => null);
    if (!res?.ok || typeof res.body !== "object" || res.body === null) {
      return null;
    }
    const body = res.body as {
      escalate?: unknown;
      reply?: unknown;
      tool_calls?: unknown;
    };

    if (typeof body.reply === "string" && body.reply.trim().length > 0) {
      if (body.reply.length > MAX_REPLY_LEN) {
        return null;
      }
      return {
        escalate: escalate || body.escalate === true,
        reply: body.reply,
      };
    }

    const calls = parseCalls(body.tool_calls);
    if (!calls || round === MAX_TOOL_ROUNDS) {
      return null;
    }

    messages.push({
      role: "assistant",
      tool_calls: calls.map((c) => ({
        args: (c.args ?? {}) as Record<string, unknown>,
        id: c.id as string,
        name: c.name as string,
      })),
    });
    for (const call of calls) {
      const out = await runBotTool(
        ctx,
        call.name as string,
        call.args as Record<string, unknown> | undefined
      );
      escalate = escalate || out.escalate === true;
      messages.push({
        content: JSON.stringify(out.result),
        name: call.name as string,
        role: "tool",
        tool_call_id: call.id as string,
      });
    }
  }
  return null;
}
