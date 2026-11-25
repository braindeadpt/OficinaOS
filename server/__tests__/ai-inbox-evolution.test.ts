import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleEvolutionInbound,
  sendViaEvolutionAntiBan,
} from "../services/evolution-bot.service.js";

/**
 * §G.7 — entitlement "ai-inbox" SEM "whatsapp-bot": o inbound Evolution
 * grava-se na caixa de entrada mas o bot NÃO responde. E vice-versa:
 * com ambos, o pipeline normal corre.
 */

const mocks = vi.hoisted(() => ({
  handleInboundMessage: vi.fn(async () => ({
    reply: { customerName: "Ana", escalate: false, jobId: null, text: "ok" },
    sent: true,
  })),
  recordInboundMessage: vi.fn(async () => ({
    conversationId: "conv-1",
    created: true,
    messageId: "msg-1",
  })),
  revokeConsentForPhone: vi.fn(async () => undefined),
  sendEvolutionText: vi.fn(async () => ({ success: true })),
}));

vi.mock("../services/bot-intents.js", () => ({
  escalateToStaff: vi.fn(async () => undefined),
  findCustomersByPhone: vi.fn(async () => [{ id: "c1", name: "Ana" }]),
  handleInboundMessage: mocks.handleInboundMessage,
  isStopText: (t: string) => ["parar", "stop"].includes(t.trim().toLowerCase()),
  rateOk: vi.fn(() => true),
  revokeConsentForPhone: mocks.revokeConsentForPhone,
}));

vi.mock("../services/inbox.service.js", () => ({
  INBOX_CHANNEL_EVOLUTION: "evolution",
  recordInboundMessage: mocks.recordInboundMessage,
}));

vi.mock("../services/evolution.service.js", () => ({
  getEvolutionState: vi.fn(async () => "open"),
  sendEvolutionPresence: vi.fn(async () => ({ success: true })),
  sendEvolutionText: mocks.sendEvolutionText,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: vi.fn(),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((v: string) => `dec:${v}`),
}));

vi.mock("../lib/demo.js", () => ({ assertNotDemoMode: vi.fn() }));

import { getOrCreateShopSettings } from "../repositories/settings.repository.js";

const getSettings = getOrCreateShopSettings as unknown as ReturnType<
  typeof vi.fn
>;

const log = { error: vi.fn(), warn: vi.fn() } as never;

const EVO_ID_RE = /^evo-E/;

function settingsWith(entitlements: string[]) {
  return {
    botAvgRepairDaysAfterPart: 1,
    botInfoText: null,
    cloudApiUrl: "https://cloud.example",
    cloudEntitlements: entitlements,
    cloudShopTokenEncrypted: "enc:tok",
    cloudSyncedAt: new Date(), // fresco — isModuleEnabled exige <24h
    currency: "EUR",
    evolutionApiKeyEncrypted: "enc:key",
    evolutionInstance: "oficinaos",
    evolutionUrl: "http://evo.local",
    shopName: "Loja",
    whatsappBotDailyCap: 200,
    whatsappBotDisclaimerAt: new Date(),
    whatsappBotSuspendedAt: null,
    whatsappEnabled: true,
    whatsappTransport: "evolution",
  };
}

// seenMessageIds do serviço é global por módulo (dedupe de re-entrega
// Evolution): cada teste precisa de um id único, senão a mensagem é
// descartada antes de chegar à inbox.
let seq = 0;
function envelope(text = "olá") {
  seq += 1;
  return {
    data: {
      key: {
        fromMe: false,
        id: `E${seq}`,
        remoteJid: "351912345678@s.whatsapp.net",
      },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
    event: "messages.upsert",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleEvolutionInbound — §G.7", () => {
  it("ai-inbox sem whatsapp-bot: grava na inbox, NÃO responde", async () => {
    getSettings.mockResolvedValue(settingsWith(["ai-inbox"]));
    await handleEvolutionInbound({} as never, log, undefined, envelope());
    expect(mocks.recordInboundMessage).toHaveBeenCalledTimes(1);
    const call = (mocks.recordInboundMessage.mock.calls[0] as unknown[])[2] as {
      channel: string;
      externalId: string;
      phone: string;
      text: string;
    };
    expect(call.channel).toBe("evolution");
    expect(call.externalId).toMatch(EVO_ID_RE);
    expect(call.text).toBe("olá");
    // O bot nunca corre — sem pipeline, sem envio.
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
    expect(mocks.sendEvolutionText).not.toHaveBeenCalled();
  });

  it("ai-inbox sem whatsapp-bot: PARAR revoga consentimento sem responder", async () => {
    getSettings.mockResolvedValue(settingsWith(["ai-inbox"]));
    await handleEvolutionInbound(
      {} as never,
      log,
      undefined,
      envelope("PARAR")
    );
    expect(mocks.recordInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.revokeConsentForPhone).toHaveBeenCalledTimes(1);
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
    expect(mocks.sendEvolutionText).not.toHaveBeenCalled();
  });

  it("sem nenhum módulo: não grava nem responde", async () => {
    getSettings.mockResolvedValue(settingsWith([]));
    await handleEvolutionInbound({} as never, log, undefined, envelope());
    expect(mocks.recordInboundMessage).not.toHaveBeenCalled();
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("com ambos os módulos: grava E o bot processa", async () => {
    getSettings.mockResolvedValue(settingsWith(["ai-inbox", "whatsapp-bot"]));
    await handleEvolutionInbound({} as never, log, undefined, envelope());
    expect(mocks.recordInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  it("whatsapp-bot sem ai-inbox: bot processa sem gravar", async () => {
    getSettings.mockResolvedValue(settingsWith(["whatsapp-bot"]));
    await handleEvolutionInbound({} as never, log, undefined, envelope());
    expect(mocks.recordInboundMessage).not.toHaveBeenCalled();
    expect(mocks.handleInboundMessage).toHaveBeenCalledTimes(1);
  });
});

describe("sendViaEvolutionAntiBan — cancelamento pré-commit", () => {
  it("abort durante o atraso anti-ban cancela antes de enviar o texto", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const promise = sendViaEvolutionAntiBan(
        {} as never,
        log,
        { apiKey: "k", baseUrl: "http://evo", instance: "oficinaos" },
        "351999000111",
        "texto",
        200,
        controller.signal
      );
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
      await expect(promise).resolves.toEqual({
        error: "cancelado",
        success: false,
      });
      expect(mocks.sendEvolutionText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("abort durante a leitura das definições cancela antes de enviar o texto", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      getSettings.mockImplementationOnce(async () => {
        controller.abort();
        return settingsWith(["whatsapp-bot"]);
      });
      const promise = sendViaEvolutionAntiBan(
        {} as never,
        log,
        { apiKey: "k", baseUrl: "http://evo", instance: "oficinaos" },
        "351999000222",
        "texto",
        200,
        controller.signal
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(promise).resolves.toEqual({
        error: "cancelado",
        success: false,
      });
      expect(mocks.sendEvolutionText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
