import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(
    async (): Promise<{ body: unknown; ok: boolean; status?: number }> => ({
      body: { messages: [] },
      ok: true,
    })
  ),
  getOrCreateShopSettings: vi.fn(),
  handleInboundMessage: vi.fn(
    async (
      _ctx: unknown,
      _msg: { id?: string },
      _t: {
        allowQuoteDecision?: boolean;
        send: (text: string) => Promise<boolean>;
        silentSend?: boolean;
      }
    ) => ({ reply: { text: "resposta" }, sent: true })
  ),
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
  mocks.handleInboundMessage.mockImplementation(
    async (): Promise<{ reply: { text: string }; sent: boolean }> => ({
      reply: { text: "resposta" },
      sent: true,
    })
  );
});

describe("pollWhatsAppInbound — fila Meta com transporte Evolution", () => {
  // §5.7: a fila oficial só responde via Evolution com termo do bot
  // aceite e sem suspensão — os mesmos gates do webhook Evolution.
  it("transporte Evolution sem termo do bot → só consome PARAR/STOP", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: null,
      whatsappBotSuspendedAt: null,
      whatsappEnabled: true,
      whatsappTransport: "evolution",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            { fromPhone: "351900000001", id: "m-stop", text: "PARAR" },
            { fromPhone: "351900000002", id: "m-ask", text: "está pronto?" },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ body: {}, ok: true }); // ack
    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    // O PARAR entra no pipeline com envio suprimido (revogação legal);
    // a pergunta fica na fila até o bot ser ativado — sem ack.
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
    const call = mocks.handleInboundMessage.mock.calls[0];
    expect(call?.[1]).toMatchObject({ id: "m-stop" });
    expect(await call?.[2]?.send("x")).toBe(true); // send suprimido
    expect(call?.[2]?.allowQuoteDecision).toBe(false);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud",
      "/whatsapp/inbound/ack",
      expect.objectContaining({ body: { ids: ["m-stop"] } })
    );
  });

  it("PARAR em modo bloqueado revoga o consentimento no pipeline real", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: null,
      whatsappBotSuspendedAt: null,
      whatsappEnabled: true,
      whatsappTransport: "evolution",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    // Pipeline real — o mock do handleInboundMessage provava routing,
    // não a revogação. O STOP tem de gravar whatsappConsent=false.
    const real =
      await vi.importActual<typeof import("../bot-intents.js")>(
        "../bot-intents.js"
      );
    mocks.handleInboundMessage.mockImplementation(
      real.handleInboundMessage as never
    );
    const customerUpdate = vi.fn(async () => ({}));
    const prismaReal = {
      $queryRaw: vi.fn(async () => [
        { id: "c1", name: "Ana", phone: "900000001" },
      ]),
      customer: {
        update: customerUpdate,
      },
      job: { findMany: vi.fn(async () => []) },
      shopSettings: {
        findUnique: vi.fn(async () => ({ countryCode: "PT" })),
      },
    } as never;
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            {
              fromPhone: "351900000001",
              id: "m-stop",
              messageType: "text",
              text: "PARAR",
            },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ body: {}, ok: true });
    await pollWhatsAppInbound(
      prismaReal,
      "https://cloud",
      "tok",
      log,
      undefined
    );
    expect(customerUpdate).toHaveBeenCalledWith({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: "c1" },
    });
  });

  it("transporte Evolution com bot suspenso → só consome PARAR/STOP", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappBotDisclaimerAt: new Date(),
      whatsappBotSuspendedAt: new Date(),
      whatsappEnabled: true,
      whatsappTransport: "evolution",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    mocks.cloudFetch.mockResolvedValueOnce({
      body: {
        messages: [
          { fromPhone: "351900000001", id: "m-stop", text: "stop" },
          { fromPhone: "351900000002", id: "m-sim", text: "SIM" },
        ],
      },
      ok: true,
    });
    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.handleInboundMessage.mock.calls[0]?.[1]).toMatchObject({
      id: "m-stop",
    });
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

describe("pollWhatsAppInbound — ai-inbox sem canal WhatsApp resolvido", () => {
  it("regista inbound mas suprime envios E decisões de orçamento", async () => {
    // Regressão Devin: em modo só-inbox o SIM/NÃO continuava a aprovar
    // orçamentos em silêncio — sem canal de resposta real não pode
    // haver decisão de quote.
    mocks.getOrCreateShopSettings.mockResolvedValue({
      cloudEntitlements: ["ai-inbox"],
      cloudSyncedAt: new Date(),
      whatsappBotDisclaimerAt: null,
      whatsappBotSuspendedAt: null,
      whatsappEnabled: true,
      whatsappTransport: "meta",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(null);
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            { fromPhone: "351900000001", id: "m-sim", text: "SIM" },
            { fromPhone: "351900000002", id: "m-ask", text: "está pronto?" },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ body: {}, ok: true }); // ack

    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(2);
    for (const call of mocks.handleInboundMessage.mock.calls) {
      expect(call?.[2]?.allowQuoteDecision).toBe(false);
      expect(call?.[2]?.silentSend).toBe(true);
    }
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.cloudFetch).toHaveBeenLastCalledWith(
      "https://cloud",
      "/whatsapp/inbound/ack",
      expect.objectContaining({ body: { ids: ["m-sim", "m-ask"] } })
    );
  });
});

describe("pollWhatsAppInbound — contrato da fila oficial", () => {
  it("sentAt ISO da row chega intacto ao handler (messageAt do ponto)", async () => {
    // GET /whatsapp/inbound devolve sentAt por row — o poller passa a
    // row inteira e o ponto usa-a como messageAt no /ponto/evaluate
    // (a validade do código mede-se ao ENVIO na Meta, não à receção).
    mocks.getOrCreateShopSettings.mockResolvedValue({
      whatsappEnabled: true,
      whatsappTransport: "meta",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue({
      apiUrl: "https://cloud",
      mode: "cloud",
      shopToken: "tok",
    });
    const sentAt = "2026-01-10T08:00:00.000Z";
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            {
              createdAt: "2026-01-10T08:05:00.000Z",
              fromPhone: "351900000001",
              id: "m-sent",
              messageType: "text",
              sentAt,
              text: "ENTRADA",
            },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ body: {}, ok: true }); // ack

    await pollWhatsAppInbound(prisma, "https://cloud", "tok", log, undefined);
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.handleInboundMessage.mock.calls[0]?.[1]).toMatchObject({
      sentAt,
    });
  });
});

describe("pollWhatsAppInbound — sunset sem canal nem ai-inbox", () => {
  it("consome só PARAR/STOP, revoga consentimento e deixa mensagens normais na fila", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      cloudEntitlements: ["whatsapp-bot"],
      cloudSyncedAt: new Date(),
      whatsappEnabled: true,
      whatsappTransport: "meta",
    });
    mocks.resolveWhatsAppChannel.mockReturnValue(null);
    const customerUpdate = vi.fn(async () => ({}));
    const prismaReal = {
      $queryRaw: vi.fn(async () => [
        { id: "c1", name: "Ana", phone: "900000001" },
      ]),
      customer: { update: customerUpdate },
      shopSettings: {
        findUnique: vi.fn(async () => ({ countryCode: "PT" })),
      },
    } as never;
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            { fromPhone: "351900000001", id: "m-stop", text: "PARAR" },
            { fromPhone: "351900000002", id: "m-ask", text: "está pronto?" },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ body: {}, ok: true });

    await pollWhatsAppInbound(
      prismaReal,
      "https://cloud",
      "tok",
      log,
      undefined
    );

    expect(customerUpdate).toHaveBeenCalledWith({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: "c1" },
    });
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
    expect(mocks.cloudFetch).toHaveBeenLastCalledWith(
      "https://cloud",
      "/whatsapp/inbound/ack",
      expect.objectContaining({ body: { ids: ["m-stop"] } })
    );
  });
});
