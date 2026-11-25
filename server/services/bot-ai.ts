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

export interface BotAiRulesContext {
  aiEnabled?: boolean;
  allowQuoteDecision?: boolean;
  currency: string;
  customers: { id: string; name: string }[];
  jobs: {
    customerName: string;
    deviceName: string;
    estimatedDate: string | null;
    id: string;
    jobCode: string;
    partsWaiting: { expectedAt: string | null; partName: string }[];
    quotes: {
      amount: number;
      id: string;
      note: string | null;
      sentAt: string | null;
      status: string;
      version: number;
    }[];
    status: string;
  }[];
  messageCreatedAt: string;
  messageType: string;
  shopLabel: string;
  timezone?: string;
}

export interface BotAiInput {
  channel: "sms" | "whatsapp" | "evolution";
  /** WP0.4 — contexto das regras determinísticas: só na primeira ronda
   *  (as seguintes são continuações de ferramentas, sem texto novo). */
  context?: BotAiRulesContext;
  /** Histórico da conversa gravada na inbox (§G.4) — últimas mensagens
   *  ANTES da atual; substitui o transporte de contexto na request. */
  history?: { content: string; role: "assistant" | "user" }[];
  phone: string;
  userText: string;
}

export interface BotAiResult {
  /** Ação devolvida pelas regras da Cloud — a app valida e aplica
   *  localmente (a Cloud não toca na BD da loja). */
  action?:
    | {
        decision: "approve" | "reject";
        jobCode: string;
        kind: "quote_decision";
        quoteId: string;
      }
    | { kind: "stop_consent" };
  actionFailureText?: string;
  actionSuccessText?: string;
  escalate: boolean;
  jobId?: string | null;
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

interface BotAiBody {
  action?: unknown;
  actionFailureText?: unknown;
  actionSuccessText?: unknown;
  calls?: unknown;
  escalate?: unknown;
  jobId?: unknown;
  reply?: unknown;
  type?: unknown;
}

/** Corre as tool calls pedidas e regista as mensagens. Devolve escalate. */
async function runToolCalls(
  ctx: BotToolCtx,
  calls: BotAiCall[],
  messages: BotAiMessage[]
): Promise<boolean> {
  messages.push({
    role: "assistant",
    tool_calls: calls.map((c) => ({
      args: (c.args ?? {}) as Record<string, unknown>,
      id: c.id as string,
      name: c.name as string,
    })),
  });
  let escalate = false;
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
  return escalate;
}

function parseAction(raw: unknown): BotAiResult["action"] {
  if (typeof raw !== "object" || raw === null) {
    return;
  }
  const a = raw as Record<string, unknown>;
  if (a.kind === "stop_consent") {
    return { kind: "stop_consent" };
  }
  if (
    a.kind === "quote_decision" &&
    (a.decision === "approve" || a.decision === "reject") &&
    typeof a.jobCode === "string" &&
    typeof a.quoteId === "string"
  ) {
    return {
      decision: a.decision,
      jobCode: a.jobCode,
      kind: "quote_decision",
      quoteId: a.quoteId,
    };
  }
  return;
}

function parseReply(body: BotAiBody, escalate: boolean): BotAiResult | null {
  if (body.type !== "reply" || typeof body.reply !== "string") {
    return null;
  }
  const action = parseAction(body.action);
  // Reply vazio só é válido com ação (decisão de orçamento escalada —
  // a app escolhe o texto depois de a aplicar) ou em escalada pura.
  if (
    (body.reply.trim().length === 0 && !action) ||
    body.reply.length > MAX_REPLY_LEN
  ) {
    return null;
  }
  return {
    action,
    actionFailureText:
      typeof body.actionFailureText === "string"
        ? body.actionFailureText
        : undefined,
    actionSuccessText:
      typeof body.actionSuccessText === "string"
        ? body.actionSuccessText
        : undefined,
    escalate: escalate || body.escalate === true,
    jobId: typeof body.jobId === "string" ? body.jobId : null,
    reply: body.reply,
  };
}

export async function askBotAi(
  ctx: BotToolCtx,
  cloud: { apiUrl: string; token: string },
  input: BotAiInput
): Promise<BotAiResult | null> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const messages: BotAiMessage[] = [
    ...(input.history ?? []),
    { content: input.userText, role: "user" },
  ];
  let escalate = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return null;
    }
    const res = await cloudFetch(cloud.apiUrl, "/ai/bot-reply", {
      body: {
        channel: input.channel,
        // O contexto das regras vai só na primeira ronda — nas
        // continuações de ferramentas não há mensagem nova do cliente.
        ...(round === 0 && input.context ? { context: input.context } : {}),
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
    const body = res.body as BotAiBody;

    const reply = parseReply(body, escalate);
    if (reply) {
      return reply;
    }

    const calls = body.type === "tool_calls" ? parseCalls(body.calls) : null;
    if (!calls || round === MAX_TOOL_ROUNDS) {
      return null;
    }
    escalate = (await runToolCalls(ctx, calls, messages)) || escalate;
  }
  return null;
}
