import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
  runBotTool: vi.fn(
    async (): Promise<{ escalate?: boolean; result: unknown }> => ({
      result: { ok: true },
    })
  ),
}));

vi.mock("../cloud.service.js", () => ({ cloudFetch: mocks.cloudFetch }));
vi.mock("../bot-tools.js", () => ({
  runBotTool: mocks.runBotTool,
}));

import { askBotAi } from "../bot-ai.js";
import type { BotToolCtx } from "../bot-tools.js";

const ctx = {
  currency: "EUR",
  customerIds: ["cust-1"],
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
  portalApiUrl: null,
  portalEnabled: false,
  prisma: {} as never,
  shopCard: { botAvgRepairDaysAfterPart: 1, botInfoText: null },
} satisfies BotToolCtx;

const cloud = { apiUrl: "http://cloud", token: "tok" };
const input = { channel: "whatsapp" as const, phone: "3519", userText: "ola" };

const ok = (body: unknown) => ({ body, ok: true, status: 200 });

beforeEach(() => vi.clearAllMocks());

describe("askBotAi", () => {
  it("returns a direct reply", async () => {
    mocks.cloudFetch.mockResolvedValueOnce(
      ok({ escalate: false, reply: "Fechamos às 18h.", type: "reply" })
    );
    const res = await askBotAi(ctx, cloud, input);
    expect(res).toEqual({
      action: undefined,
      actionFailureText: undefined,
      actionSuccessText: undefined,
      escalate: false,
      jobId: undefined,
      reply: "Fechamos às 18h.",
    });
  });

  it("empty reply with escalate is a valid silent escalation", async () => {
    mocks.cloudFetch.mockResolvedValueOnce(
      ok({ escalate: true, jobId: null, reply: "", type: "reply" })
    );
    const res = await askBotAi(ctx, cloud, input);
    // Válido: um SIM stale escala em silêncio — reply vazio, jobId null
    // explícito (não undefined) para não ligar reparação nenhuma.
    expect(res?.reply).toBe("");
    expect(res?.escalate).toBe(true);
    expect(res?.jobId).toBeNull();
  });

  it("empty reply without action or escalate is invalid", async () => {
    mocks.cloudFetch.mockResolvedValueOnce(
      ok({ escalate: false, reply: "", type: "reply" })
    );
    const res = await askBotAi(ctx, cloud, input);
    expect(res).toBeNull();
  });

  it("executes tool calls locally and resends the conversation", async () => {
    mocks.cloudFetch
      .mockResolvedValueOnce(
        ok({
          calls: [{ args: {}, id: "c1", name: "info_loja" }],
          type: "tool_calls",
        })
      )
      .mockResolvedValueOnce(ok({ reply: "Fechamos às 18h.", type: "reply" }));

    const res = await askBotAi(ctx, cloud, input);
    expect(res?.reply).toBe("Fechamos às 18h.");
    expect(mocks.runBotTool).toHaveBeenCalledWith(ctx, "info_loja", {});
    // Second request carries the tool result in the conversation.
    const secondBody = mocks.cloudFetch.mock.calls[1]?.[2]?.body as {
      messages: { role: string; name?: string }[];
    };
    expect(secondBody.messages.at(-1)).toMatchObject({
      name: "info_loja",
      role: "tool",
      tool_call_id: "c1",
    });
  });

  it("propagates escalate from pedir_humano tool calls", async () => {
    mocks.runBotTool.mockResolvedValueOnce({
      escalate: true,
      result: { ok: true },
    });
    mocks.cloudFetch
      .mockResolvedValueOnce(
        ok({
          calls: [{ args: {}, id: "c1", name: "pedir_humano" }],
          type: "tool_calls",
        })
      )
      .mockResolvedValueOnce(
        ok({ reply: "Um humano responde já.", type: "reply" })
      );
    const res = await askBotAi(ctx, cloud, input);
    expect(res?.escalate).toBe(true);
  });

  it.each([
    402, 429, 500,
  ])("returns null on HTTP %d — deterministic fallback", async (status) => {
    mocks.cloudFetch.mockResolvedValueOnce({ body: {}, ok: false, status });
    expect(await askBotAi(ctx, cloud, input)).toBeNull();
  });

  it("returns null on malformed JSON body", async () => {
    mocks.cloudFetch.mockResolvedValueOnce(ok({ nonsense: true }));
    expect(await askBotAi(ctx, cloud, input)).toBeNull();
  });

  it("returns null when tool_calls are malformed", async () => {
    mocks.cloudFetch.mockResolvedValueOnce(
      ok({ calls: [{ name: "info_loja" }], type: "tool_calls" })
    );
    expect(await askBotAi(ctx, cloud, input)).toBeNull();
  });

  it("returns null on network error", async () => {
    mocks.cloudFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await askBotAi(ctx, cloud, input)).toBeNull();
  });

  it("gives up after the tool-round cap", async () => {
    // exatamente 4 respostas na fila: initial + 3 rondas — uma a mais
    // ficava na fila e vazava para o teste seguinte (clearAllMocks não
    // limpa a fila de once)
    for (let i = 0; i < 4; i += 1) {
      mocks.cloudFetch.mockResolvedValueOnce(
        ok({
          calls: [{ args: {}, id: `c${i}`, name: "info_loja" }],
          type: "tool_calls",
        })
      );
    }
    expect(await askBotAi(ctx, cloud, input)).toBeNull();
    // 4 HTTP calls: initial + 3 tool rounds
    expect(mocks.cloudFetch).toHaveBeenCalledTimes(4);
  });
});

const KEY_FORMAT = /^[0-9a-f]{48}$/;

describe("conversationKey (WP1)", () => {
  function bodies(): Record<string, unknown>[] {
    return mocks.cloudFetch.mock.calls.map(
      (c) => (c[2] as { body: Record<string, unknown> }).body
    );
  }

  it("primeira ronda envia hash opaca e estável — nunca o telefone", async () => {
    mocks.cloudFetch.mockResolvedValue(
      ok({ escalate: false, reply: "ok", type: "reply" })
    );
    await askBotAi(ctx, cloud, {
      ...input,
      phone: "+351 910 111 222",
    });
    // a mesma chamada com o mesmo número noutra formatação
    await askBotAi(ctx, cloud, {
      ...input,
      phone: "351910111222",
    });

    // exatamente duas chamadas HTTP — mais alguma seria resposta vazada
    // da fila de outro teste a fingir ser ronda de ferramentas
    expect(mocks.cloudFetch.mock.calls).toHaveLength(2);
    const keyed = bodies().filter((b) => b.conversationKey !== undefined);
    // uma chave por ronda 0 — duas chamadas, duas chaves
    expect(keyed).toHaveLength(2);
    const key = String(keyed[0].conversationKey);
    expect(key).toMatch(KEY_FORMAT);
    // estável para o mesmo número independentemente da formatação
    expect(keyed[1].conversationKey).toBe(keyed[0].conversationKey);
    // nunca o número nem parte dele em lado nenhum do payload
    for (const b of bodies()) {
      expect(JSON.stringify(b)).not.toContain("910111222");
    }
  });

  it("rondas de ferramentas não reenviam a chave", async () => {
    mocks.cloudFetch
      .mockResolvedValueOnce(
        ok({
          calls: [{ args: {}, id: "c1", name: "info_loja" }],
          type: "tool_calls",
        })
      )
      .mockResolvedValueOnce(
        ok({ escalate: false, reply: "pronto", type: "reply" })
      );
    await askBotAi(ctx, cloud, input);
    const all = bodies();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // a chave aparece uma única vez — na ronda 0
    expect(all[0].conversationKey).toBeTypeOf("string");
    for (const b of all.slice(1)) {
      expect(b.conversationKey).toBeUndefined();
    }
  });
});
