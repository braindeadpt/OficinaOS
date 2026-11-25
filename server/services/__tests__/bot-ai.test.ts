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
    for (let i = 0; i < 5; i += 1) {
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
