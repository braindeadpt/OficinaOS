import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptSecret: vi.fn((v: string) => (v.startsWith("enc:") ? v.slice(4) : v)),
  escalateToStaff: vi.fn(() => Promise.resolve()),
  findCustomerByPhone: vi.fn(
    async (): Promise<{ id: string } | null> => ({ id: "c1" })
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

vi.mock("../../repositories/customer.repository.js", () => ({
  findCustomerByPhone: mocks.findCustomerByPhone,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

vi.mock("../bot-intents.js", async (importOriginal) => ({
  ...(await importOriginal()),
  escalateToStaff: mocks.escalateToStaff,
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
  mocks.findCustomerByPhone.mockResolvedValue({ id: "c1" });
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

  it("número desconhecido → notifica staff, sem resposta", async () => {
    mocks.findCustomerByPhone.mockResolvedValue(null);
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
