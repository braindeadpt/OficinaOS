import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSmsDeviceStatus,
  sendSmsViaCloud,
  syncSmsInbound,
} from "../services/sms-cloud.service.js";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
  handleInboundMessage: vi.fn(),
}));

vi.mock("../services/cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
}));

vi.mock("../services/bot-intents.js", () => ({
  handleInboundMessage: mocks.handleInboundMessage,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: vi.fn(async () => ({
    botAiEnabled: false,
    botAvgRepairDaysAfterPart: 1,
    botInfoText: null,
    currency: "EUR",
    phone: "210000000",
    shopName: "Loja X",
  })),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((v: string) => `dec:${v}`),
}));

vi.mock("../lib/demo.js", () => ({ assertNotDemoMode: vi.fn() }));

const log = {
  error: vi.fn(),
  warn: vi.fn(),
} as never;

function fakePrisma() {
  const outbox = {
    findUnique: vi.fn(({ where }: { where: { id: string } }) => {
      if (where.id === "ob-1") {
        return Promise.resolve({ id: "ob-1", status: "QUEUED" });
      }
      if (where.id === "ob-sent") {
        return Promise.resolve({ id: "ob-sent", status: "SENT" });
      }
      return Promise.resolve(null);
    }),
    update: vi.fn(async () => ({})),
  };
  return { notificationOutbox: outbox, outbox } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handleInboundMessage.mockResolvedValue({ sent: true });
});

describe("sendSmsViaCloud", () => {
  it("posts /sms/send with dedupeId + jobCode and maps HTTP errors", async () => {
    mocks.cloudFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const ok = await sendSmsViaCloud(
      { apiUrl: "https://c", token: "t" },
      { dedupeId: "d1", jobCode: "REP-9", text: "ola", to: "+3519" }
    );
    expect(ok.success).toBe(true);
    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://c",
      "/sms/send",
      expect.objectContaining({
        body: { dedupeId: "d1", jobCode: "REP-9", text: "ola", to: "+3519" },
        method: "POST",
        token: "t",
      })
    );

    mocks.cloudFetch.mockResolvedValueOnce({
      body: { code: "NO_SMS_DEVICE" },
      ok: false,
      status: 409,
    });
    const fail = await sendSmsViaCloud(
      { apiUrl: "https://c", token: "t" },
      { dedupeId: "d2", text: "x", to: "+3519" }
    );
    expect(fail).toEqual({ error: "NO_SMS_DEVICE", success: false });
  });
});

describe("syncSmsInbound", () => {
  it("RECEIVED → pipeline do bot com envio pela Cloud + ack", async () => {
    let sent: ((text: string) => Promise<boolean>) | undefined;
    mocks.handleInboundMessage.mockImplementationOnce(
      async (
        _ctx: unknown,
        _msg: unknown,
        t: { send: (text: string) => Promise<boolean> }
      ) => {
        sent = t.send;
        return { sent: await t.send("resposta") };
      }
    );
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            {
              createdAt: "2026-01-01",
              fromPhone: "351912345678",
              id: "in-1",
              text: "REP-1234",
              kind: "RECEIVED",
            },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ ok: true, status: 200 }) // reply send
      .mockResolvedValueOnce({ ok: true, status: 200 }); // ack
    await syncSmsInbound(fakePrisma(), "https://c", "tok", log, undefined, [
      "sms",
    ]);
    const replyCall = mocks.cloudFetch.mock.calls[1];
    expect(replyCall[1]).toBe("/sms/send");
    expect(
      (replyCall[2] as { body: { dedupeId: string; to: string } }).body.dedupeId
    ).toBe("bot-in-1");
    expect(sent).toBeDefined();
    const ackCall = mocks.cloudFetch.mock.calls[2];
    expect(ackCall[1]).toBe("/sms/inbound/ack");
    expect((ackCall[2] as { body: { ids: string[] } }).body.ids).toEqual([
      "in-1",
    ]);
  });

  it("REPORT DELIVERED/SENT marca o outbox SENT; FAILED marca FAILED", async () => {
    const prisma = fakePrisma();
    mocks.cloudFetch
      .mockResolvedValueOnce({
        body: {
          messages: [
            {
              createdAt: "t",
              fromPhone: "",
              id: "r1",
              refId: "ob-1",
              statusType: "DELIVERED",
              kind: "REPORT",
            },
            {
              createdAt: "t",
              fromPhone: "",
              id: "r2",
              refId: "ob-1",
              statusType: "FAILED",
              kind: "REPORT",
            },
            {
              createdAt: "t",
              fromPhone: "",
              id: "r3",
              refId: "nope",
              statusType: "SENT",
              kind: "REPORT",
            },
          ],
        },
        ok: true,
      })
      .mockResolvedValueOnce({ ok: true }); // ack
    await syncSmsInbound(prisma, "https://c", "tok", log, undefined, ["sms"]);
    const updates = (prisma as { outbox: { update: ReturnType<typeof vi.fn> } })
      .outbox.update.mock.calls;
    expect(updates[0][0].data.status).toBe("SENT");
    expect(updates[1][0].data.status).toBe("FAILED");
    expect(updates[1][0].data.error).toContain("failed");
    const ack = mocks.cloudFetch.mock.calls.at(-1);
    expect((ack?.[2] as { body: { ids: string[] } }).body.ids).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("fila indisponível → sai sem ack nem erro", async () => {
    mocks.cloudFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await syncSmsInbound(fakePrisma(), "https://c", "tok", log, undefined, [
      "sms",
    ]);
    expect(mocks.cloudFetch).toHaveBeenCalledTimes(1);
    expect(mocks.handleInboundMessage).not.toHaveBeenCalled();
  });
});

describe("getSmsDeviceStatus", () => {
  it("sem entitlement devolve entitled:false sem chamar a Cloud", async () => {
    const prisma = {
      shopSettings: { findUnique: vi.fn(async () => null) },
    } as never;
    const status = await getSmsDeviceStatus(prisma);
    expect(status).toEqual({
      configured: false,
      device: null,
      entitled: false,
      reachable: false,
    });
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });
});
