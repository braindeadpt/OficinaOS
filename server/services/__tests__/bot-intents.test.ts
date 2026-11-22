import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askBotAi: vi.fn(),
  createManyAndReturnInAppNotifications: vi.fn(async () => []),
  findManyUsers: vi.fn(async () => []),
  respondToQuote: vi.fn(async () => ({ error: undefined })),
}));

vi.mock("../bot-ai.js", () => ({ askBotAi: mocks.askBotAi }));
vi.mock("../../repositories/notification.repository.js", () => ({
  createManyAndReturnInAppNotifications:
    mocks.createManyAndReturnInAppNotifications,
  findManyUsers: mocks.findManyUsers,
}));
vi.mock("../job-quote.service.js", () => ({
  respondToQuote: mocks.respondToQuote,
}));

import type { BotReplyCtx } from "../bot-intents.js";
import { composeReply } from "../bot-intents.js";

const PHONE = "351912345678";

function job(over: Record<string, unknown> = {}) {
  return {
    customer: { name: "Ana" },
    device: { brand: { name: "Apple" }, model: "iPhone 13" },
    estimatedDate: null,
    id: "job-1",
    jobCode: "REP-2024-000001-AAA",
    quotes: [
      {
        amount: { toNumber: () => 100 },
        id: "q1",
        note: null,
        status: "SENT",
        version: 1,
      },
    ],
    status: "IN_REPAIR",
    ...over,
  };
}

function makeCtx(opts: {
  ai?: BotReplyCtx["ai"];
  customers?: { id: string; name: string; phone: string }[];
  jobs?: ReturnType<typeof job>[];
}) {
  const prisma = {
    customer: {
      findMany: vi.fn(async () => opts.customers ?? []),
      update: vi.fn(async () => ({})),
    },
    job: {
      findMany: vi.fn(async () => opts.jobs ?? []),
    },
  };
  const ctx: BotReplyCtx = {
    ai: opts.ai,
    currency: "EUR",
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    notifyCtx: undefined,
    prisma: prisma as never,
    shopLabel: "Loja X",
  };
  return { ctx, prisma };
}

const aiCfg = {
  apiUrl: "http://cloud",
  avgRepairDaysAfterPart: 1,
  botInfoText: "Aberto 09:00-18:00",
  channel: "whatsapp" as const,
  enabled: true,
  module: "whatsapp-bot",
  modules: ["whatsapp-bot"],
  token: "tok",
};

const msg = (text: string | null, type = "text") => ({
  createdAt: new Date().toISOString(),
  fromPhone: PHONE,
  id: "m1",
  messageType: type,
  text,
});

const cust = { id: "cust-1", name: "Ana", phone: "351912345678" };

beforeEach(() => vi.clearAllMocks());

describe("composeReply — deterministic rules before AI", () => {
  it("sim with pending quote approves without calling AI", async () => {
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("sim"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(mocks.respondToQuote).toHaveBeenCalledOnce();
    expect(out.text).toContain("aceite");
  });

  it("PARAR disables consent and replies without AI", async () => {
    const { ctx, prisma } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job()],
    });
    const out = await composeReply(ctx, msg("PARAR"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: { whatsappConsent: false },
      where: { id: "cust-1" },
    });
    expect(out.text).toContain("mensagens automáticas");
  });

  it("REP code of another customer is not resolved (not in jobs)", async () => {
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job()],
    });
    // Different code — never reaches the AI or returns the other job.
    const out = await composeReply(ctx, msg("REP-2024-000001-BBB"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).not.toContain("BBB");
  });

  it("free text calls the AI when flag+module allow it", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "Fechamos às 18h.",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("a que horas fecham?"));
    expect(mocks.askBotAi).toHaveBeenCalledOnce();
    expect(out.text).toBe("Fechamos às 18h.");
  });

  it("AI timeout/failure falls back to deterministic reply", async () => {
    mocks.askBotAi.mockResolvedValueOnce(null);
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("quando fica pronto?"));
    expect(mocks.askBotAi).toHaveBeenCalledOnce();
    // fallback = statusText of the single active job
    expect(out.text).toContain("REP-2024-000001-AAA");
    expect(out.text).toContain("Em reparação");
  });

  it("AI is skipped when flag is off — pure deterministic", async () => {
    const { ctx } = makeCtx({
      ai: { ...aiCfg, enabled: false },
      customers: [cust],
      jobs: [job()],
    });
    const out = await composeReply(ctx, msg("a que horas fecham?"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).toContain("REP-2024-000001-AAA");
  });

  it("AI is skipped when the channel module is not entitled", async () => {
    const { ctx } = makeCtx({
      ai: { ...aiCfg, modules: [] },
      customers: [cust],
      jobs: [job()],
    });
    await composeReply(ctx, msg("a que horas fecham?"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
  });

  it("AI escalate flag propagates to BotReply", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: true,
      reply: "Já chamo um humano.",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("isto está muito complicado"));
    expect(out.escalate).toBe(true);
  });
});
