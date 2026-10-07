import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../../lib/crypto.js";

const mocks = vi.hoisted(() => ({
  createManyAndReturnInAppNotifications: vi.fn(),
  findManyUsers: vi.fn(),
  respondToQuote: vi.fn(),
}));

vi.mock("../../repositories/notification.repository.js", () => ({
  createManyAndReturnInAppNotifications:
    mocks.createManyAndReturnInAppNotifications,
  findManyUsers: mocks.findManyUsers,
}));

vi.mock("../job-quote.service.js", () => ({
  respondToQuote: mocks.respondToQuote,
}));

import {
  checkSmsGateway,
  decryptSmsConfig,
  handleInboundSms,
  registerSmsWebhook,
  sendSms,
} from "../sms.service.js";

const config = {
  password: "gw-pass",
  url: "http://192.168.1.50:8080",
  user: "sms",
};

const EXPECTED_AUTH = `Basic ${Buffer.from("sms:gw-pass").toString("base64")}`;
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;

function fetchOk(body: unknown = {}) {
  return vi.fn(async () => ({
    json: async () => body,
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }));
}

function fakePrisma(row: Record<string, unknown>) {
  return {
    customer: { findMany: vi.fn(async () => []) },
    job: { findMany: vi.fn(async () => []) },
    shopSettings: {
      findUnique: vi.fn(async () => row),
    },
  } as never;
}

const ENABLED_ROW = {
  cloudEntitlements: ["sms"],
  countryCode: "PT",
  currency: "EUR",
  phone: "912345678",
  shopName: "Loja Teste",
  smsEnabled: true,
  smsGatewayPasswordEncrypted: encryptSecret("gw-pass"),
  smsGatewayUrl: "http://192.168.1.50:8080",
  smsGatewayUser: "sms",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("decryptSmsConfig", () => {
  it("returns null when any field is missing", () => {
    expect(
      decryptSmsConfig({
        gatewayPasswordEncrypted: null,
        gatewayUrl: "http://gw",
        gatewayUser: "u",
      })
    ).toBeNull();
    expect(
      decryptSmsConfig({
        gatewayPasswordEncrypted: "x",
        gatewayUrl: null,
        gatewayUser: "u",
      })
    ).toBeNull();
  });

  it("decrypts an encrypted password and strips trailing slashes", () => {
    const res = decryptSmsConfig({
      gatewayPasswordEncrypted: encryptSecret("s3cret"),
      gatewayUrl: "http://gw:8080/",
      gatewayUser: "sms",
    });
    expect(res).toEqual({
      password: "s3cret",
      url: "http://gw:8080",
      user: "sms",
    });
  });

  it("passes through a plaintext password (legacy rows)", () => {
    const res = decryptSmsConfig({
      gatewayPasswordEncrypted: "plain-pass",
      gatewayUrl: "http://gw:8080",
      gatewayUser: "sms",
    });
    expect(res?.password).toBe("plain-pass");
  });
});

describe("sendSms", () => {
  it("POSTs to /message with basic auth and E.164 phone", async () => {
    const fetchMock = fetchOk({ id: "m1", state: "Pending" });
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendSms(
      config,
      "0912345678",
      "A tua reparação está pronta",
      "PT"
    );

    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://192.168.1.50:8080/message");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      EXPECTED_AUTH
    );
    const body = JSON.parse(init.body as string);
    expect(body.textMessage.text).toBe("A tua reparação está pronta");
    expect(body.phoneNumbers).toEqual(["+351912345678"]);
  });

  it("surfaces gateway errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      }))
    );
    const res = await sendSms(config, "912345678", "hi");
    expect(res.success).toBe(false);
    expect(res.error).toContain("401");
  });

  it("returns error when the gateway is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED")))
    );
    const res = await sendSms(config, "912345678", "hi");
    expect(res).toEqual({ error: "ECONNREFUSED", success: false });
  });
});

describe("checkSmsGateway", () => {
  it("pings /health with basic auth", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkSmsGateway(config);
    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://192.168.1.50:8080/health");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      EXPECTED_AUTH
    );
  });
});

describe("registerSmsWebhook", () => {
  it("re-registers idempotently: deletes the old hook, POSTs the new one", async () => {
    const calls: { init: RequestInit; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ init, url });
        if (init.method === "DELETE") {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({
          json: async () => [{ id: "oficinaos-inbound" }],
          ok: true,
          status: 200,
          text: async () => "",
        });
      })
    );

    const res = await registerSmsWebhook(
      config,
      "http://192.168.1.10:4000/api/public/sms/inbound/tok123"
    );

    expect(res.success).toBe(true);
    expect(calls[0]?.url).toBe("http://192.168.1.50:8080/webhooks");
    expect(calls[1]?.init.method).toBe("DELETE");
    const reg = calls.find((c) => c.init.method === "POST");
    expect(JSON.parse(reg?.init.body as string)).toEqual({
      event: "sms:received",
      id: "oficinaos-inbound",
      url: "http://192.168.1.10:4000/api/public/sms/inbound/tok123",
    });
  });
});

describe("handleInboundSms", () => {
  it("replies even without cloud entitlements — SMS is core", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const prisma = fakePrisma({ ...ENABLED_ROW, cloudEntitlements: [] });

    await handleInboundSms(prisma, log, undefined, "351912345678", "estado?");

    expect(fetchMock).toHaveBeenCalled();
  });

  it("does nothing when smsEnabled is false", async () => {
    const fetchMock = fetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const prisma = fakePrisma({ ...ENABLED_ROW, smsEnabled: false });

    await handleInboundSms(prisma, log, undefined, "351912345678", "oi");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replies via the gateway with the unknown-customer text and escalates to staff", async () => {
    const fetchMock = fetchOk({ id: "m1" });
    vi.stubGlobal("fetch", fetchMock);
    const prisma = fakePrisma(ENABLED_ROW);
    mocks.findManyUsers.mockResolvedValue([{ id: "u1" }]);
    mocks.createManyAndReturnInAppNotifications.mockResolvedValue([]);

    await handleInboundSms(
      prisma,
      log,
      { prisma } as never,
      "+351999888777",
      "qual é o estado?"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://192.168.1.50:8080/message");
    const body = JSON.parse(init.body as string);
    expect(body.phoneNumbers).toEqual(["+351999888777"]);
    expect(body.textMessage.text).toContain("Não encontrei reparações");
    // Escalated: staff was looked up
    expect(mocks.findManyUsers).toHaveBeenCalled();
  });
});
