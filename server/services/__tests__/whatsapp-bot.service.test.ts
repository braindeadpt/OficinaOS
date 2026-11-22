import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(async () => ({ body: { messages: [] }, ok: true })),
  getOrCreateShopSettings: vi.fn(),
  handleInboundMessage: vi.fn(async () => ({
    reply: { text: "resposta" },
    sent: true,
  })),
  resolveWhatsAppChannel: vi.fn(),
  sendWhatsAppText: vi.fn(async () => ({ success: true })),
}));

vi.mock("../cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

vi.mock("../bot-intents.js", async (importOriginal) => ({
  ...(await importOriginal()),
  handleInboundMessage: mocks.handleInboundMessage,
}));

vi.mock("../whatsapp-channel.js", () => ({
  maskPhone: (p: string) => p,
  pushCredentialsToCloud: vi.fn(async () => undefined),
  resolveWhatsAppChannel: mocks.resolveWhatsAppChannel,
  sendWhatsAppText: mocks.sendWhatsAppText,
}));

import { pollWhatsAppInbound } from "../whatsapp-bot.service.js";

const prisma = {} as never;
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;

const EVOLUTION_CHANNEL = {
  config: { apiKey: "k", baseUrl: "http://evo:8080", instance: "oficinaos" },
  mode: "evolution" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cloudFetch.mockResolvedValue({ body: { messages: [] }, ok: true });
});

describe("pollWhatsAppInbound — fila Meta com transporte Evolution", () => {
  // §5.7: a fila oficial só responde via Evolution com termo do bot
  // aceite e sem suspensão — os mesmos gates do webhook Evolution.
  it("transporte Evolution sem termo do bot → não lê a fila", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: null,
      whatsappBotSuspendedAt: null,
      whatsappEnabled: true,
      whatsappTransport: "evolution",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("transporte Evolution com bot suspenso → não lê a fila", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: new Date(),
      whatsappBotSuspendedAt: new Date(),
      whatsappEnabled: true,
      whatsappTransport: "evolution",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("transporte Evolution com termo aceite e sem suspensão → lê a fila", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: new Date(),
      whatsappBotSuspendedAt: null,
      whatsappEnabled: true,
      whatsappTransport: "evolution",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud",
      "/whatsapp/inbound",
      expect.objectContaining({ token: "tok" })
    );
  });

  it("transporte cloud/local → lê a fila sem os gates Evolution", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: null,
      whatsappBotSuspendedAt: new Date(),
      whatsappEnabled: true,
    });
    mocks.resolveWhatsAppChannel.mockReturnValue({
      apiUrl: "https://cloud",
      mode: "cloud",
      shopToken: "tok",
    });
    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.cloudFetch).toHaveBeenCalled();
  });
});
