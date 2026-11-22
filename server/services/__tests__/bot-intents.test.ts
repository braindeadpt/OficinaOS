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
    partsWaiting: [],
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

  it("remetente +34 com os mesmos 9 dígitos não vê a ficha do cliente PT", async () => {
    // Cliente guardado sem indicativo; remetente espanhol com o mesmo
    // sufixo — antes casava por sufixo e expunha histórico/valores.
    const { ctx } = makeCtx({
      customers: [{ ...cust, phone: "912345678" }],
      jobs: [job()],
    });
    const out = await composeReply(ctx, {
      createdAt: new Date().toISOString(),
      fromPhone: "34912345678",
      id: "m2",
      messageType: "text",
      text: "estado da minha reparação",
    });
    expect(out.text).toContain("Não encontrei reparações");
  });

  it("remetente PT sem indicativo continua a casar pelo sufixo", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [job({ quotes: [] })],
    });
    const out = await composeReply(ctx, {
      createdAt: new Date().toISOString(),
      fromPhone: "912345678",
      id: "m3",
      messageType: "text",
      text: "estado",
    });
    expect(out.text).toContain("REP-2024-000001-AAA");
  });

  it('"quanto tempo falta" recebe a previsão, não o orçamento', async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          estimatedDate: new Date("2026-12-30T12:00:00Z"),
          quotes: [],
        }),
      ],
    });
    const out = await composeReply(ctx, msg("quanto tempo falta?"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).toContain("Previsão");
    expect(out.text).not.toContain("orçamento de");
  });

  it("AI timeout/failure falls back to deterministic reply", async () => {
    mocks.askBotAi.mockResolvedValueOnce(null);
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    // Mensagem neutra que chega à IA (não casa TIME_RE/QUOTE_RE/código).
    const out = await composeReply(ctx, msg("obrigado pelo contacto"));
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

  it("«previsão de chegada da peça» responde com a data da peça, não o estado", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          partsWaiting: [
            {
              expectedAt: new Date("2026-12-05T12:00:00Z"),
              partName: "Ecrã iPhone 13",
            },
            { expectedAt: null, partName: "Bateria" },
          ],
          quotes: [],
          status: "WAITING_FOR_PARTS",
        }),
      ],
    });
    const out = await composeReply(
      ctx,
      msg("Qual é a previsão de chegada da peça?")
    );
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    // A data registada tem de aparecer na linha da peça certa — não basta
    // a frase genérica «chegada prevista».
    const expected = new Date("2026-12-05T12:00:00Z").toLocaleDateString(
      "pt-PT",
      { timeZone: "Europe/Lisbon" }
    );
    expect(out.text).toContain(
      `Ecrã iPhone 13 — chegada prevista: ${expected}`
    );
    // A peça sem data também é nomeada — não fica escondida.
    expect(out.text).toContain("Bateria — sem data prevista");
  });

  it("«quando chega a peça» sem data registada diz que ainda não há data", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          partsWaiting: [{ expectedAt: null, partName: "Bateria" }],
          quotes: [],
          status: "WAITING_FOR_PARTS",
        }),
      ],
    });
    const out = await composeReply(ctx, msg("quando chega a peça?"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).toContain("Bateria");
    expect(out.text).toContain("sem data prevista");
  });

  it("«prazo da reparação? Já paguei a peça.» responde ao prazo — a peça é contexto", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          estimatedDate: new Date("2026-12-03T12:00:00Z"),
          partsWaiting: [
            {
              expectedAt: new Date("2026-12-05T12:00:00Z"),
              partName: "Ecrã iPhone 13",
            },
          ],
          quotes: [],
          status: "WAITING_FOR_PARTS",
        }),
      ],
    });
    const out = await composeReply(
      ctx,
      msg("Qual é o prazo da reparação? Já paguei a peça.")
    );
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    // Estado/previsão da reparação em primeiro — a peça vem como contexto.
    expect(out.text).toContain("está:");
    expect(out.text).toContain("Previsão");
  });

  it("responder só com o código mostra a reparação com a data da peça", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          partsWaiting: [
            {
              expectedAt: new Date("2026-12-05T12:00:00Z"),
              partName: "Ecrã iPhone 13",
            },
          ],
          quotes: [],
          status: "WAITING_FOR_PARTS",
        }),
      ],
    });
    const out = await composeReply(ctx, msg("REP-2024-000001-AAA"));
    expect(out.text).toContain("está:");
    // A data registada da peça aparece — «Ecrã iPhone 13 — sem data
    // prevista» não pode passar neste teste.
    const expected = new Date("2026-12-05T12:00:00Z").toLocaleDateString(
      "pt-PT",
      { timeZone: "Europe/Lisbon" }
    );
    expect(out.text).toContain(
      `Ecrã iPhone 13 — chegada prevista: ${expected}`
    );
  });

  it("reparação pronta não repete peças em falta — o registo pode ficar por apagar", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          partsWaiting: [{ expectedAt: null, partName: "Ecrã iPhone 13" }],
          quotes: [],
          status: "DONE",
        }),
      ],
    });
    const out = await composeReply(ctx, msg("REP-2024-000001-AAA"));
    expect(out.text).toContain("Pronto para levantar");
    expect(out.text).not.toContain("Peças em falta");
    expect(out.text).not.toContain("Ecrã iPhone 13");
  });

  it("«previsão para o preço» é pergunta de orçamento", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [job({ quotes: [] })],
    });
    const out = await composeReply(ctx, msg("Qual é a previsão para o preço?"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).toContain("orçamento");
    expect(out.text).not.toContain("está:");
  });

  it("«Qual é a previsão? O preço já sei.» devolve a previsão, não o orçamento", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [
        job({
          estimatedDate: new Date("2026-12-03T12:00:00Z"),
          quotes: [],
        }),
      ],
    });
    const out = await composeReply(
      ctx,
      msg("Qual é a previsão? O preço já sei.")
    );
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).toContain("Previsão");
    expect(out.text).not.toContain("Orçamento");
  });

  it("«previsão de preço» continua a ser pergunta de orçamento", async () => {
    const { ctx } = makeCtx({
      customers: [cust],
      jobs: [job({ quotes: [] })],
    });
    const out = await composeReply(ctx, msg("tens previsão de preço?"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.text).toContain("orçamento");
  });

  it("«quando está aberta a loja» não é prazo — chega à IA", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "Aberto das 9h às 18h.",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("Quando está aberta a loja?"));
    expect(mocks.askBotAi).toHaveBeenCalledOnce();
    expect(out.text).toBe("Aberto das 9h às 18h.");
  });
});
