import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptSecret: vi.fn((v: string) => (v.startsWith("enc:") ? v.slice(4) : v)),
  escalateToStaff: vi.fn(() => Promise.resolve()),
  findCustomersByPhone: vi.fn(
    async (): Promise<{ id: string; name: string }[]> => [
      { id: "c1", name: "Cliente" },
    ]
  ),
  getEvolutionState: vi.fn(async () => "open"),
  getOrCreateShopSettings: vi.fn(),
  handleInboundMessage: vi.fn(async (_ctx, _msg, t) => {
    await t.send("resposta");
    return { reply: { text: "resposta" }, sent: true };
  }),
  sendEvolutionPresence: vi.fn(() => Promise.resolve()),
  sendEvolutionText: vi.fn(
    async (): Promise<{ error?: string; success: boolean }> => ({
      success: true,
    })
  ),
  updateSettings: vi.fn(async () => ({})),
}));

vi.mock("../../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

vi.mock("../bot-intents.js", async (importOriginal) => ({
  ...(await importOriginal()),
  escalateToStaff: mocks.escalateToStaff,
  findCustomersByPhone: mocks.findCustomersByPhone,
  handleInboundMessage: mocks.handleInboundMessage,
}));

vi.mock("../evolution.service.js", () => ({
  getEvolutionState: mocks.getEvolutionState,
  sendEvolutionPresence: mocks.sendEvolutionPresence,
  sendEvolutionText: mocks.sendEvolutionText,
}));

import { handleEvolutionInbound } from "../evolution-bot.service.js";

const prisma = { shopSettings: { update: mocks.updateSettings } } as never;
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;

const SETTINGS = {
  cloudEntitlements: ["whatsapp-bot"],
  // isModuleEnabled exige cache fresco (<24 h) — sem isto o gate fecha.
  cloudSyncedAt: new Date(),
  cloudShopTokenEncrypted: "enc:shop-token",
  evolutionApiKeyEncrypted: "enc:evo-key",
  evolutionInstance: "oficinaos",
  evolutionUrl: "http://evo:8080",
  whatsappBotDailyCap: 200,
  whatsappBotDisclaimerAt: new Date(),
  whatsappEnabled: true,
  whatsappTransport: "evolution",
};

function envelope(over: Record<string, unknown> = {}) {
  return {
    data: {
      key: {
        fromMe: false,
        id: `msg-${Math.random().toString(36).slice(2)}`,
        remoteJid: "351912345678@s.whatsapp.net",
      },
      message: { conversation: "Olá, como está a reparação?" },
      messageTimestamp: Math.floor(Date.now() / 1000),
      messageType: "conversation",
      ...over,
    },
    event: "messages.upsert",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // O send do bot espera 3–8 s (presença "a escrever…") — timers falsos
  // avançam o relógio sem atrasar a suite.
  vi.useFakeTimers();
  mocks.getOrCreateShopSettings.mockResolvedValue({ ...SETTINGS });
  // mockResolvedValue persiste entre testes — repõe os defaults.
  mocks.findCustomersByPhone.mockResolvedValue([{ id: "c1", name: "Cliente" }]);
  mocks.sendEvolutionText.mockResolvedValue({ success: true });
  mocks.getEvolutionState.mockResolvedValue("open");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleEvolutionInbound — gates", () => {
  it("sem termo do bot aceite → não processa", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      whatsappBotDisclaimerAt: null,
    });
    await handleEvolutionInbound(prisma, log, undefined, envelope());
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("sem entitlement whatsapp-bot → não processa (grátis)", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      cloudEntitlements: [],
    });
    await handleEvolutionInbound(prisma, log, undefined, envelope());
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("entitlement em cache expirado (>24 h) → não processa", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      cloudSyncedAt: new Date(Date.now() - 25 * 3600 * 1000),
    });
    await handleEvolutionInbound(prisma, log, undefined, envelope());
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("suspenso por erro de sessão → não processa", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      whatsappBotSuspendedAt: new Date(),
    });
    await handleEvolutionInbound(prisma, log, undefined, envelope());
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });
});

describe("handleEvolutionInbound — proteções anti-ban", () => {
  it("ignora fromMe, grupos, broadcast e newsletter", async () => {
    for (const key of [
      { fromMe: true, id: "a", remoteJid: "351912345678@s.whatsapp.net" },
      { fromMe: false, id: "b", remoteJid: "120@g.us" },
      { fromMe: false, id: "c", remoteJid: "status@broadcast" },
      { fromMe: false, id: "d", remoteJid: "123@newsletter" },
    ]) {
      await handleEvolutionInbound(prisma, log, undefined, envelope({ key }));
    }
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
    expect(mocks.escalateToStaff).not.toHaveBeenCalled();
  });

  it("deduplica pelo id da mensagem", async () => {
    const env = envelope({
      key: { id: "same-id", remoteJid: "351912345678@s.whatsapp.net" },
    });
    const p1 = handleEvolutionInbound(prisma, log, undefined, env);
    await vi.runAllTimersAsync();
    await p1;
    await handleEvolutionInbound(prisma, log, undefined, env);
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  it("DM por LID usa o telefone real de remoteJidAlt — não os dígitos do LID", async () => {
    // WhatsApp LID: o remoteJid vem «<lid>@lid» e os seus dígitos não
    // são o telefone — sem a troca o trabalhador nunca correspondia ao
    // staff e a resposta ia para um número inexistente.
    const env = envelope({
      key: {
        fromMe: false,
        id: `lid-${Math.random().toString(36).slice(2)}`,
        remoteJid: "100000000000000@lid",
        remoteJidAlt: "351912345678@s.whatsapp.net",
      },
    });
    const p = handleEvolutionInbound(prisma, log, undefined, env);
    await vi.runAllTimersAsync();
    await p;
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
    const msg = mocks.handleInboundMessage.mock.calls[0]?.[1] as {
      fromPhone: string;
    };
    expect(msg.fromPhone).toBe("351912345678");
  });

  it("número desconhecido → notifica staff, sem resposta", async () => {
    mocks.findCustomersByPhone.mockResolvedValue([]);
    await handleEvolutionInbound(prisma, log, undefined, envelope());
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
    expect(mocks.sendEvolutionText).not.toHaveBeenCalled();
    expect(mocks.escalateToStaff).toHaveBeenCalledTimes(1);
  });

  it("mensagem não-texto → escala ao staff sem resposta", async () => {
    await handleEvolutionInbound(
      prisma,
      log,
      undefined,
      envelope({ message: { imageMessage: {} }, messageType: "imageMessage" })
    );
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
    expect(mocks.escalateToStaff).toHaveBeenCalledTimes(1);
  });

  it("responde com presença + atraso e limite de 10/h por número", async () => {
    const p = handleEvolutionInbound(prisma, log, undefined, envelope());
    // O send espera 3–8 s (presença "a escrever…") — esgota os timers.
    await vi.runAllTimersAsync();
    await p;
    const t = mocks.handleInboundMessage.mock.calls[0]?.[2] as {
      rateLimitPerHour?: number;
    };
    expect(t.rateLimitPerHour).toBe(10);
    expect(mocks.sendEvolutionPresence).toHaveBeenCalled();
    expect(mocks.sendEvolutionText).toHaveBeenCalled();
  });

  it("PARAR sem confirmação (acima do limite horário) devolve a vaga diária", async () => {
    // Módulo fresco — o dayCount de testes anteriores não interfere
    // num teto de 1 mensagem.
    vi.resetModules();
    const fresh = await import("../evolution-bot.service.js");
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      whatsappBotDailyCap: 1,
    });
    // O pipeline gravou o opt-out mas suprimiu a confirmação —
    // texto vazio = nenhum envio ao cliente, vaga devolvida.
    mocks.handleInboundMessage.mockResolvedValueOnce({
      reply: { text: "" },
      sent: true,
    });
    const p1 = fresh.handleEvolutionInbound(prisma, log, undefined, envelope());
    await vi.runAllTimersAsync();
    await p1;
    // Com cap=1, uma segunda mensagem só processa se a vaga da
    // primeira tiver sido devolvida.
    const p2 = fresh.handleEvolutionInbound(prisma, log, undefined, envelope());
    await vi.runAllTimersAsync();
    await p2;
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(2);
  });

  it("PARAR acima do teto diário revoga na mesma — envio suprimido", async () => {
    // Módulo fresco — dayCount/seenMessageIds limpos; cap=0 → teto já
    // excedido na primeira mensagem.
    vi.resetModules();
    const fresh = await import("../evolution-bot.service.js");
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      whatsappBotDailyCap: 0,
    });
    await fresh.handleEvolutionInbound(
      prisma,
      log,
      undefined,
      envelope({ message: { conversation: "PARAR" } })
    );
    // O pipeline correu (a revogação é gravada dentro dele)…
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
    // …mas a confirmação não sai pela Evolution — send suprimido.
    expect(mocks.sendEvolutionText).not.toHaveBeenCalled();
    // Uma mensagem normal acima do teto nem chega ao pipeline.
    await fresh.handleEvolutionInbound(
      prisma,
      log,
      undefined,
      envelope({ message: { conversation: "estado" } })
    );
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  it("PARAR de número dual-role (staff ponto + cliente) → ponto responde E consentimento revoga", async () => {
    // O ponto corre antes do pipeline de clientes: sem a revogação
    // transversal o PARAR morria como "comando desconhecido" e os
    // avisos automáticos continuavam autorizados.
    const staff = {
      externalWork: false,
      id: "u-staff",
      name: "Rui",
      phoneE164: "+351912345678",
      pontoSmsAllowed: false,
      username: "rui",
    };
    const customerUpdate = vi.fn(() => Promise.resolve({}));
    const prismaFull = {
      customer: {
        // revokeConsentForPhone usa a findCustomersByPhone real (a
        // versão interna do módulo) — precisa do findMany+update.
        findMany: vi.fn(async () => [
          { id: "cust-1", name: "Rui", phone: "+351912345678" },
        ]),
        update: customerUpdate,
      },
      shopSettings: { update: mocks.updateSettings },
      user: { findMany: vi.fn(async () => [staff]) },
    } as never;
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...SETTINGS,
      cloudEntitlements: ["ponto", "whatsapp-bot"],
    });
    const p = handleEvolutionInbound(
      prismaFull,
      log,
      undefined,
      envelope({ message: { conversation: "PARAR" } })
    );
    // O send do ponto espera 3–8 s (presença "a escrever…").
    await vi.runAllTimersAsync();
    await p;
    // O ponto consumiu a mensagem — a resposta é a lista de comandos,
    // não a do pipeline de clientes ("resposta" do mock).
    expect(mocks.sendEvolutionText).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining("Comandos"),
      expect.anything()
    );
    // …e o consentimento do cliente foi revogado na mesma.
    expect(customerUpdate).toHaveBeenCalledWith({
      data: { whatsappConsent: false },
      where: { id: "cust-1" },
    });
    // Nunca chegou ao pipeline de clientes.
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("sessão fechada no envio → suspende o bot e avisa o staff", async () => {
    mocks.sendEvolutionText.mockResolvedValue({
      error: "Connection Closed",
      success: false,
    });
    mocks.getEvolutionState.mockResolvedValue("close");
    const p = handleEvolutionInbound(prisma, log, undefined, envelope());
    await vi.runAllTimersAsync();
    await p;
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappBotSuspendedAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.escalateToStaff).toHaveBeenCalled();
  });
});
