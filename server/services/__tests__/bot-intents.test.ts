import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askBotAi: vi.fn(),
  createManyAndReturnInAppNotifications: vi.fn(async () => []),
  findManyUsers: vi.fn(async () => []),
  respondToQuote: vi.fn(
    async (): Promise<{ error?: string; jobExists: boolean }> => ({
      jobExists: true,
    })
  ),
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
import {
  composeReply,
  findCustomersByPhone,
  handleInboundMessage,
  revokeConsentForPhone,
} from "../bot-intents.js";

const PHONE = "351912345678";

function job(over: Record<string, unknown> = {}) {
  return {
    accessCode: "portal-token",
    color: null,
    depositAmount: null,
    device: { brand: { name: "Apple" }, model: "iPhone 13" },
    estimatedCost: null,
    estimatedDate: null,
    externalRepairs: [],
    hasLoanerDevice: false,
    id: "job-1",
    jobCode: "REP-2024-000001-AAA",
    loanerReturnedAt: null,
    notes: [],
    partsUsed: [],
    partsWaiting: [],
    payments: [],
    portalPublishedAt: null,
    quotes: [
      {
        amount: { toNumber: () => 100 },
        id: "q1",
        note: null,
        sentAt: new Date("2026-11-20T10:00:00.000Z"),
        status: "SENT",
        version: 1,
      },
    ],
    repairs: [],
    status: "IN_REPAIR",
    warrantyForJobId: null,
    ...over,
  };
}

function makeCtx(opts: {
  ai?: BotReplyCtx["ai"];
  customers?: { id: string; name: string; phone: string }[];
  jobs?: ReturnType<typeof job>[];
}) {
  const prisma = {
    $queryRaw: vi.fn(async () => opts.customers ?? []),
    customer: {
      update: vi.fn(async () => ({})),
    },
    job: {
      findMany: vi.fn(async () => opts.jobs ?? []),
    },
    shopSettings: {
      findUnique: vi.fn(async () => ({ countryCode: "PT" })),
    },
  };
  const ctx: BotReplyCtx = {
    ai: opts.ai,
    currency: "EUR",
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    notifyCtx: undefined,
    prisma: prisma as never,
    shopLabel: "Loja X",
    timezone: "Europe/Lisbon",
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

/** Chaves estáveis do payload — arrays entram como `[]` e só o primeiro
 *  objeto contribui (a forma é igual em todos os elementos). */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    const firstObject = value.find(
      (item) => item !== null && typeof item === "object"
    );
    return firstObject ? keyPaths(firstObject, `${prefix}[]`) : [];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.keys(value)
    .sort()
    .flatMap((key) => {
      const child = (value as Record<string, unknown>)[key];
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...keyPaths(child, path)];
    });
}

beforeEach(() => vi.clearAllMocks());
describe("composeReply — transporte WP0.4 (regras na Cloud)", () => {
  it("PARAR revoga o consentimento localmente sem chamar a Cloud", async () => {
    const { ctx, prisma } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job()],
    });
    const out = await composeReply(ctx, msg("PARAR"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { whatsappConsent: false, whatsappConsentAt: null },
      })
    );
    expect(out.text).toContain("deixas de receber");
  });

  it("quote_decision: aplica respondToQuote e usa o texto de sucesso", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      action: {
        decision: "approve",
        jobCode: "REP-2024-000001-AAA",
        kind: "quote_decision",
        quoteId: "q1",
      },
      actionFailureText: "já foi respondido",
      actionSuccessText: "Orçamento aceite ✅",
      escalate: false,
      jobId: "job-1",
      reply: "",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("sim"));
    expect(mocks.respondToQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: "REP-2024-000001-AAA",
        decision: "approve",
        phone4: PHONE.slice(-4),
        quoteId: "q1",
      }),
      expect.anything()
    );
    expect(out.text).toBe("Orçamento aceite ✅");
  });

  it("quote_decision com quoteId fora do contexto não executa nada", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      action: {
        decision: "approve",
        jobCode: "REP-2024-000001-AAA",
        kind: "quote_decision",
        quoteId: "q-inventado",
      },
      actionFailureText: "Não consegui aplicar esse orçamento",
      escalate: false,
      jobId: null,
      reply: "",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("sim"));
    expect(mocks.respondToQuote).not.toHaveBeenCalled();
    expect(out.text).toBe("Não consegui aplicar esse orçamento");
  });

  it("quote_decision fora da janela não executa, mesmo com o quoteId real", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      action: {
        decision: "approve",
        jobCode: "REP-2024-000001-AAA",
        kind: "quote_decision",
        quoteId: "q1",
      },
      actionFailureText: "Não consegui aplicar esse orçamento",
      escalate: false,
      jobId: null,
      reply: "",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("sim"), false, {
      allowQuoteDecision: false,
    });
    expect(mocks.respondToQuote).not.toHaveBeenCalled();
    expect(out.text).toBe("Não consegui aplicar esse orçamento");
  });

  it("quote_decision sobre orçamento já respondido no contexto não executa nada", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      action: {
        decision: "approve",
        jobCode: "REP-2024-000001-AAA",
        kind: "quote_decision",
        quoteId: "q1",
      },
      actionFailureText: "Esse orçamento já foi respondido",
      escalate: false,
      jobId: null,
      reply: "",
    });
    const respondedJob = job({
      quotes: [
        {
          amount: { toNumber: () => 100 },
          id: "q1",
          note: null,
          sentAt: new Date("2026-11-20T10:00:00.000Z"),
          status: "APPROVED",
          version: 1,
        },
      ],
    });
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [respondedJob],
    });
    const out = await composeReply(ctx, msg("sim"));
    expect(mocks.respondToQuote).not.toHaveBeenCalled();
    expect(out.text).toBe("Esse orçamento já foi respondido");
  });

  it("quote_decision recusada (SUPERSEDED) usa o texto de falha", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      action: {
        decision: "approve",
        jobCode: "REP-2024-000001-AAA",
        kind: "quote_decision",
        quoteId: "q1",
      },
      actionFailureText: "Esse orçamento já foi respondido",
      actionSuccessText: "Orçamento aceite ✅",
      escalate: false,
      jobId: null,
      reply: "",
    });
    // Recusas vêm como resultado, não exceção — sem este caminho o
    // cliente recebia confirmação de um orçamento que ficou igual.
    mocks.respondToQuote.mockResolvedValueOnce({
      error: "QUOTE_SUPERSEDED",
      jobExists: true,
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("sim"));
    expect(out.text).toBe("Esse orçamento já foi respondido");
    expect(out.text).not.toContain("aceite");
  });

  it("quote_decision falha na BD → texto de falha composto na Cloud", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      action: {
        decision: "reject",
        jobCode: "REP-2024-000001-AAA",
        kind: "quote_decision",
        quoteId: "q1",
      },
      actionFailureText: "Esse orçamento já foi respondido",
      actionSuccessText: "recusado",
      escalate: false,
      jobId: null,
      reply: "",
    });
    mocks.respondToQuote.mockRejectedValueOnce(new Error("already"));
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("não"));
    expect(out.text).toBe("Esse orçamento já foi respondido");
  });

  it("Cloud em baixo (null) → escala para staff sem regras locais", async () => {
    mocks.askBotAi.mockResolvedValueOnce(null);
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("como está a minha reparação?"));
    expect(out.escalate).toBe(true);
    expect(out.text).toContain("a loja responde-te já");
    // Uma única reparação ativa: ligar o alerta a ela é seguro.
    expect(out.jobId).toBe("job-1");
  });

  it("Cloud em baixo com 2+ reparações ativas → escala sem adivinhar (jobId null)", async () => {
    mocks.askBotAi.mockResolvedValueOnce(null);
    // Mesma regra do resolveCloudJobId: sem qualquer indicação da
    // Cloud, ligar o alerta à reparação mais recente seria adivinhação.
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job(), job({ id: "job-2", jobCode: "REP-2024-000002-BBB" })],
    });
    const out = await composeReply(ctx, msg("como está a minha reparação?"));
    expect(out.escalate).toBe(true);
    expect(out.jobId).toBeNull();
  });

  it("sem configuração de canal → escala para staff", async () => {
    const { ctx } = makeCtx({ customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.escalate).toBe(true);
  });

  it("fallback sem cliente casado não deixa vírgula pendurada nem espaço duplo", async () => {
    const { ctx } = makeCtx({ customers: [], jobs: [] });
    const out = await composeReply(ctx, msg("olá"));
    expect(out.escalate).toBe(true);
    expect(out.text).toBe("Recebemos a tua mensagem — a loja responde-te já.");
  });

  it("dataPrevista segue o fuso do contexto quando o dia da loja difere do dia UTC", async () => {
    mocks.askBotAi.mockResolvedValue({ escalate: false, reply: "ok" });
    // 01:30 UTC de 26/11 — em Lisboa já é dia 26, em Nova Iorque
    // ainda é 25 ao fim da tarde. O fuso errado trocava o dia da
    // previsão que a Cloud lê ao cliente.
    const estimated = new Date("2026-11-26T01:30:00.000Z");
    const base = {
      ai: aiCfg,
      customers: [cust],
      jobs: [job({ estimatedDate: estimated })],
    };
    const ny = makeCtx(base);
    ny.ctx.timezone = "America/New_York";
    await composeReply(ny.ctx, msg("quando fica?"));
    expect(mocks.askBotAi.mock.calls[0]?.[2].context.jobs[0].dataPrevista).toBe(
      "2026-11-25"
    );

    mocks.askBotAi.mockClear();
    const lisbon = makeCtx(base);
    await composeReply(lisbon.ctx, msg("quando fica?"));
    expect(mocks.askBotAi.mock.calls[0]?.[2].context.jobs[0].dataPrevista).toBe(
      "2026-11-26"
    );
  });

  it("contexto usa a vistaCliente e o snapshot das chaves fica fechado", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "ok",
    });
    const sentAt = new Date("2026-11-20T10:00:00.000Z");
    const estimated = new Date("2026-12-01T00:00:00.000Z");
    const partExpectedAt = new Date("2026-11-28T12:00:00.000Z");
    const externalReturnAt = new Date("2026-12-05T12:00:00.000Z");
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [
        job({
          estimatedDate: estimated,
          externalRepairs: [
            { expectedReturnAt: externalReturnAt, status: "SENT" },
          ],
          notes: [{ content: "nota visível" }],
          partsWaiting: [{ expectedAt: partExpectedAt, partName: "ecrã" }],
          quotes: [
            {
              amount: { toNumber: () => 100 },
              id: "q1",
              note: "Inclui a peça",
              sentAt,
              status: "SENT",
              version: 1,
            },
          ],
        }),
      ],
    });
    await composeReply(ctx, msg("como está?"), false, {
      allowQuoteDecision: true,
    });
    const input = mocks.askBotAi.mock.calls[0]?.[2];
    expect(input.context.customerFirstName).toBe("Ana");
    expect(input.context.customers).toBeUndefined();
    expect(input.context.allowQuoteDecision).toBe(true);
    expect(input.context.shopLabel).toBe("Loja X");
    const j = input.context.jobs[0];
    expect(j.aparelho).toBe("Apple iPhone 13");
    expect(j.codigo).toBe("REP-2024-000001-AAA");
    expect(j.dataPrevista).toBe("2026-12-01");
    expect(j.estado).toBe("Em reparação");
    expect(j.orcamento).toMatchObject({
      enviadoEm: sentAt.toISOString(),
      estado: "por responder",
      id: "q1",
      nota: "Inclui a peça",
      versao: 1,
    });
    expect(j.orcamento.valor).toContain("100");
    expect(j.id).toBeUndefined();
    expect(j.jobCode).toBeUndefined();
    expect(j.quotes).toBeUndefined();
    expect(j.status).toBeUndefined();
    expect(input.context.messageType).toBe("text");
    // flag on + módulo ativo → aiEnabled true
    expect(input.context.aiEnabled).toBe(true);
    expect(
      keyPaths(JSON.parse(JSON.stringify(input.context)))
    ).toMatchInlineSnapshot(`
      [
        "aiEnabled",
        "allowQuoteDecision",
        "currency",
        "customerFirstName",
        "jobs",
        "jobs[].aparelho",
        "jobs[].codigo",
        "jobs[].dataPrevista",
        "jobs[].diasAtraso",
        "jobs[].emPausa",
        "jobs[].emprestimo",
        "jobs[].estado",
        "jobs[].garantia",
        "jobs[].linkPortal",
        "jobs[].notasVisiveis",
        "jobs[].orcamento",
        "jobs[].orcamento.enviadoEm",
        "jobs[].orcamento.estado",
        "jobs[].orcamento.id",
        "jobs[].orcamento.nota",
        "jobs[].orcamento.validade",
        "jobs[].orcamento.valor",
        "jobs[].orcamento.versao",
        "jobs[].pecasEmEspera",
        "jobs[].pecasEmEspera[].chegadaPrevista",
        "jobs[].pecasEmEspera[].nome",
        "jobs[].reparacaoExterna",
        "jobs[].reparacaoExterna.regressoPrevisto",
        "jobs[].valores",
        "jobs[].valores.emFalta",
        "jobs[].valores.estimado",
        "jobs[].valores.pago",
        "jobs[].valores.sinal",
        "messageCreatedAt",
        "messageType",
        "shopLabel",
        "timezone",
      ]
    `);
  });

  it("o id interno do orçamento só atravessa quando está por responder", async () => {
    mocks.askBotAi.mockResolvedValueOnce({ escalate: false, reply: "ok" });
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [
        job({
          quotes: [
            {
              amount: { toNumber: () => 100 },
              id: "q1",
              note: null,
              sentAt: new Date("2026-11-20T10:00:00.000Z"),
              status: "APPROVED",
              version: 1,
            },
          ],
        }),
      ],
    });
    await composeReply(ctx, msg("olá"));
    const j = mocks.askBotAi.mock.calls[0]?.[2].context.jobs[0];
    expect(j.orcamento.estado).toBe("aceite");
    expect(j.orcamento.id).toBeNull();
  });

  it("fora da janela de decisão o id do orçamento não atravessa, mesmo por responder", async () => {
    mocks.askBotAi.mockResolvedValueOnce({ escalate: false, reply: "ok" });
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job()],
    });
    await composeReply(ctx, msg("olá"), false, { allowQuoteDecision: false });
    const j = mocks.askBotAi.mock.calls[0]?.[2].context.jobs[0];
    expect(j.orcamento.estado).toBe("por responder");
    expect(j.orcamento.id).toBeNull();
  });

  it("na janela de decisão o id do orçamento por responder atravessa", async () => {
    mocks.askBotAi.mockResolvedValueOnce({ escalate: false, reply: "ok" });
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job()],
    });
    await composeReply(ctx, msg("olá"));
    const j = mocks.askBotAi.mock.calls[0]?.[2].context.jobs[0];
    expect(j.orcamento.estado).toBe("por responder");
    expect(j.orcamento.id).toBe("q1");
  });

  it("só envia o primeiro nome do cliente casado, não todos os clientes", async () => {
    mocks.askBotAi.mockResolvedValueOnce({ escalate: false, reply: "ok" });
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [
        { ...cust, name: "Ana Maria Silva" },
        { id: "cust-2", name: "Bruno Costa", phone: cust.phone },
      ],
      jobs: [job()],
    });
    await composeReply(ctx, msg("olá"));
    const context = mocks.askBotAi.mock.calls[0]?.[2].context;
    expect(context.customerFirstName).toBe("Ana");
    expect(JSON.stringify(context)).not.toContain("Bruno");
    expect(JSON.stringify(context)).not.toContain("Silva");
    expect(context.customers).toBeUndefined();
  });

  it("aiEnabled false quando a flag está desligada", async () => {
    mocks.askBotAi.mockResolvedValueOnce({ escalate: false, reply: "ok" });
    const { ctx } = makeCtx({
      ai: { ...aiCfg, enabled: false },
      customers: [cust],
      jobs: [job()],
    });
    await composeReply(ctx, msg("olá"));
    expect(mocks.askBotAi.mock.calls[0]?.[2].context.aiEnabled).toBe(false);
  });

  it("aiEnabled false quando o módulo não está nos entitlements", async () => {
    mocks.askBotAi.mockResolvedValueOnce({ escalate: false, reply: "ok" });
    const { ctx } = makeCtx({
      ai: { ...aiCfg, modules: [] },
      customers: [cust],
      jobs: [job()],
    });
    await composeReply(ctx, msg("olá"));
    expect(mocks.askBotAi.mock.calls[0]?.[2].context.aiEnabled).toBe(false);
  });

  it("plainText tira o negrito WhatsApp da resposta", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "está *pronto*",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"), true);
    expect(out.text).toBe("está pronto");
  });

  it("escalate e jobId da Cloud passam para o BotReply", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: true,
      jobId: "job-1",
      reply: "passo a um colega",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"));
    expect(out.escalate).toBe(true);
    expect(out.jobId).toBe("job-1");
    expect(out.customerName).toBe("Ana");
  });

  it("jobCode devolvido pela Cloud resolve para o id local sem o expor", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: true,
      jobCode: "REP-2024-000001-AAA",
      reply: "passo a um colega",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"));
    expect(out.jobId).toBe("job-1");
  });

  it("jobId legado que também é um código REP resolve para o id local", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: true,
      jobId: "REP-2024-000001-AAA",
      reply: "passo a um colega",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"));
    expect(out.jobId).toBe("job-1");
  });

  it("Cloud legada sem jobCode/jobId assume a reparação quando só há uma", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "está a correr bem",
    });
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"));
    expect(out.jobId).toBe("job-1");
  });

  it("Cloud legada sem jobCode/jobId com 2+ reparações não adivinha — null", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "está a correr bem",
    });
    // Sem referência explícita e com duas reparações ativas, ligar à
    // primeira seria adivinhação — o staff abria a reparação errada.
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job(), job({ id: "job-2", jobCode: "REP-2024-000002-BBB" })],
    });
    const out = await composeReply(ctx, msg("olá"));
    expect(out.jobId).toBeNull();
  });

  it("PARAR bypasses the hourly flood limit — opt-out is compliance", async () => {
    mocks.askBotAi.mockResolvedValueOnce(null);
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("stop"));
    expect(out.text).toContain("deixas de receber");
  });

  it("modo só ponto: mensagem não-funcionário fica sem resposta e sem registo", async () => {
    const { ctx, prisma } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [job()],
    });
    ctx.pontoOnly = true;
    const send = vi.fn(async () => true);
    const out = await handleInboundMessage(ctx, msg("olá, têm orçamento?"), {
      channelLabel: "whatsapp",
      plainText: false,
      rateLimitPerHour: 10,
      send,
    });

    expect(out).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.askBotAi).not.toHaveBeenCalled();
  });

  it("handleInboundMessage: PARAR revoga mesmo no limite de flood, sem enviar", async () => {
    // Número único para não partilhar o balde in-memory com outros
    // testes; limite 1 — a primeira mensagem esgota a janela.
    const floodPhone = "351960000111";
    const { ctx, prisma } = makeCtx({
      ai: aiCfg,
      customers: [{ ...cust, phone: floodPhone }],
      jobs: [job()],
    });
    const send = vi.fn(async () => true);
    const transport = {
      channelLabel: "whatsapp",
      plainText: false,
      rateLimitPerHour: 1,
      send,
    };
    const m = (text: string) => ({
      createdAt: new Date().toISOString(),
      fromPhone: floodPhone,
      id: `m-${text}`,
      messageType: "text",
      text,
    });
    // Esgota a janela horária com uma mensagem normal.
    await handleInboundMessage(ctx, m("olá"), transport);
    // PARAR acima do limite: a revogação corre na mesma (obrigação
    // legal) mas a confirmação não sai — anti-ban.
    send.mockClear();
    prisma.customer.update.mockClear();
    const out = await handleInboundMessage(ctx, m("parar"), transport);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { whatsappConsent: false, whatsappConsentAt: null },
      })
    );
    expect(send).not.toHaveBeenCalled();
    // Confirmação suprimida — a revogação fica gravada mas nada sai
    // (anti-ban; o sent=true é o comportamento pré-existente do
    // pipeline para textos vazios, fora do âmbito deste PR).
    expect(out?.reply.text).toBe("");
  });
});

describe("findCustomersByPhone — ficha com separadores", () => {
  // Mock que aplica o pré-filtro LIKE sobre os dígitos como o Postgres.
  function phonePrisma(phones: string[], countryCode = "PT") {
    const rows = phones.map((phone, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      phone,
    }));
    return {
      $queryRaw: vi.fn(async (_sql: TemplateStringsArray, like: string) =>
        rows.filter((r) =>
          r.phone.replace(/\D/g, "").endsWith(like.replace("%", ""))
        )
      ),
      customer: {
        update: vi.fn(async () => ({})),
      },
      shopSettings: {
        findUnique: vi.fn(async () => ({ countryCode })),
      },
    };
  }

  it("casa +351912345678 com fichas guardadas com separadores", async () => {
    const prisma = phonePrisma([
      "+351 912 345 678",
      "912 345 678",
      "+34 912 345 678",
      "(912 345 678 )",
    ]);
    const found = await findCustomersByPhone(prisma as never, "+351912345678");
    expect(found.map((c) => c.id)).toEqual(["c0", "c1", "c3"]);
  });

  it("loja noutro país suportado não casa um +351 pelo sufixo de uma ficha nacional", async () => {
    // Loja francesa: o cliente «912 345 678» é um nacional francês,
    // não um PT — um remetente português com o mesmo sufixo não é ele.
    const prisma = phonePrisma(["912 345 678"], "FR");
    const found = await findCustomersByPhone(prisma as never, "+351912345678");
    expect(found).toEqual([]);
  });

  it("loja fora de Portugal continua a casar por número completo", async () => {
    const prisma = phonePrisma(["+351 912 345 678"], "ES");
    const found = await findCustomersByPhone(prisma as never, "+351912345678");
    expect(found.map((c) => c.id)).toEqual(["c0"]);
  });

  it("loja legada DZ usa o fallback +351 do envio e revoga um STOP nacional", async () => {
    // As primeiras instalações herdaram countryCode "DZ"; formatPhone não
    // conhece esse indicativo e envia esses nacionais como +351. O STOP
    // chega, por isso, de +351912345678 e tem de casar a ficha nacional.
    const prisma = phonePrisma(["912 345 678"], "DZ");
    await revokeConsentForPhone(prisma as never, "+351912345678");
    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: "c0" },
    });
  });

  it("PARAR revoga o consentimento e limpa a data de opt-in", async () => {
    const prisma = phonePrisma(["+351 912 345 678"]);
    await revokeConsentForPhone(prisma as never, "+351912345678");
    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: "c0" },
    });
  });
});
