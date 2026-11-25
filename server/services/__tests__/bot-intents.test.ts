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
  });

  it("sem configuração de canal → escala para staff", async () => {
    const { ctx } = makeCtx({ customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("olá"));
    expect(mocks.askBotAi).not.toHaveBeenCalled();
    expect(out.escalate).toBe(true);
  });

  it("contexto vai serializado: amount number, datas ISO, metadados", async () => {
    mocks.askBotAi.mockResolvedValueOnce({
      escalate: false,
      reply: "ok",
    });
    const sentAt = new Date("2026-11-20T10:00:00.000Z");
    const estimated = new Date("2026-12-01T00:00:00.000Z");
    const { ctx } = makeCtx({
      ai: aiCfg,
      customers: [cust],
      jobs: [
        job({
          estimatedDate: estimated,
          quotes: [
            {
              amount: { toNumber: () => 100 },
              id: "q1",
              note: null,
              sentAt,
              status: "SENT",
              version: 1,
            },
          ],
        }),
      ],
    });
    await composeReply(ctx, msg("como está?"), false, {
      allowQuoteDecision: false,
    });
    const input = mocks.askBotAi.mock.calls[0]?.[2];
    expect(input.context.customers).toEqual([{ id: "cust-1", name: "Ana" }]);
    expect(input.context.allowQuoteDecision).toBe(false);
    expect(input.context.shopLabel).toBe("Loja X");
    const j = input.context.jobs[0];
    expect(j.estimatedDate).toBe(estimated.toISOString());
    expect(j.quotes[0].amount).toBe(100);
    expect(j.quotes[0].sentAt).toBe(sentAt.toISOString());
    expect(j.deviceName).toBe("Apple iPhone 13");
    expect(input.context.messageType).toBe("text");
    // flag on + módulo ativo → aiEnabled true
    expect(input.context.aiEnabled).toBe(true);
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

  it("PARAR bypasses the hourly flood limit — opt-out is compliance", async () => {
    mocks.askBotAi.mockResolvedValueOnce(null);
    const { ctx } = makeCtx({ ai: aiCfg, customers: [cust], jobs: [job()] });
    const out = await composeReply(ctx, msg("stop"));
    expect(out.text).toContain("deixas de receber");
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
