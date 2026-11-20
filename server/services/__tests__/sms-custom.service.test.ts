import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../../lib/crypto.js";
import {
  parseCustomTemplate,
  renderTemplate,
  resolveCustomSmsConfig,
  sendCustomSms,
  templateHasPlaceholders,
} from "../sms-custom.service.js";

function fetchOk(body: string | object = "{}") {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
}

const BASE_ROW = {
  smsCustomBodyFormat: "json",
  smsCustomBodyTemplate: '{"to":"{{to}}","msg":"{{text}}"}',
  smsCustomMethod: "POST",
  smsCustomUrl: "https://api.provider.com/v1/sms",
  smsEnabled: true,
  smsTransport: "custom",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("templateHasPlaceholders / parseCustomTemplate", () => {
  it("finds placeholders nested inside objects and arrays", () => {
    const found = templateHasPlaceholders({
      payload: { items: [{ dst: "{{to}}" }, { txt: "x{{text}}" }] },
    });
    expect(found).toEqual({ text: true, to: true });
  });

  it("rejects non-JSON, non-object and placeholder-less templates", () => {
    expect(parseCustomTemplate("not json")).toBeNull();
    expect(parseCustomTemplate('["{{to}}","{{text}}"]')).toBeNull();
    expect(parseCustomTemplate('{"to":"{{to}}"}')).toBeNull();
    expect(
      parseCustomTemplate('{"to":"{{to}}","msg":"{{text}}"}')
    ).not.toBeNull();
  });
});

describe("renderTemplate", () => {
  it("substitutes placeholders inside string values only, keeping JSON safe", () => {
    const out = renderTemplate(
      {
        body: "msg: {{text}}",
        extra: { note: 'say "hi" {{to}}', n: 5 },
        to: "{{to}}",
      },
      { text: 'quote "a" \\ b', to: "+351912345678" }
    );
    expect(out).toEqual({
      body: 'msg: quote "a" \\ b',
      extra: { note: 'say "hi" +351912345678', n: 5 },
      to: "+351912345678",
    });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

describe("resolveCustomSmsConfig", () => {
  it("resolves when transport is custom with url + template", () => {
    const cfg = resolveCustomSmsConfig(BASE_ROW);
    expect(cfg?.url).toBe("https://api.provider.com/v1/sms");
    expect(cfg?.method).toBe("POST");
    expect(cfg?.bodyFormat).toBe("json");
  });

  it("returns null for wrong transport or missing fields", () => {
    expect(
      resolveCustomSmsConfig({ ...BASE_ROW, smsTransport: "android" })
    ).toBeNull();
    expect(
      resolveCustomSmsConfig({ ...BASE_ROW, smsCustomUrl: null })
    ).toBeNull();
    expect(
      resolveCustomSmsConfig({
        ...BASE_ROW,
        smsCustomBodyTemplate: '{"x":1}',
      })
    ).toBeNull();
  });

  it("decrypts the headers JSON and defaults method/format safely", () => {
    const cfg = resolveCustomSmsConfig({
      ...BASE_ROW,
      smsCustomBodyFormat: "form",
      smsCustomHeadersEncrypted: encryptSecret(
        '{"Authorization":"Bearer t0k"}'
      ),
      smsCustomMethod: "GET",
    });
    expect(cfg?.headers).toEqual({ Authorization: "Bearer t0k" });
    expect(cfg?.method).toBe("GET");
    expect(cfg?.bodyFormat).toBe("form");
  });
});

describe("sendCustomSms", () => {
  const cfg = {
    bodyFormat: "json" as const,
    bodyTemplate: { msg: "{{text}}", to: "{{to}}" },
    headers: { Authorization: "Bearer k" },
    method: "POST" as const,
    successText: null,
    url: "https://api.provider.com/v1/sms",
  };

  it("POSTs the rendered JSON template with headers", async () => {
    const fetchMock = fetchOk('{"sent":true}');
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendCustomSms(cfg, "0912345678", "olá", "PT");

    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.provider.com/v1/sms");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer k"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      msg: "olá",
      to: "+351912345678",
    });
  });

  it("sends form-urlencoded when bodyFormat is form", async () => {
    const fetchMock = fetchOk("OK");
    vi.stubGlobal("fetch", fetchMock);

    await sendCustomSms(
      { ...cfg, bodyFormat: "form" },
      "912345678",
      "a b & c",
      "PT"
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    const params = new URLSearchParams(init.body as string);
    expect(params.get("msg")).toBe("a b & c");
  });

  it("appends rendered fields as query params for GET", async () => {
    const fetchMock = fetchOk("OK");
    vi.stubGlobal("fetch", fetchMock);

    await sendCustomSms(
      { ...cfg, method: "GET" },
      "912345678",
      "ola & tu",
      "PT"
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe("GET");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("msg")).toBe("ola & tu");
    expect(parsed.searchParams.get("to")).toBe("+351912345678");
  });

  it("treats 2xx without the successText as a failure", async () => {
    vi.stubGlobal("fetch", fetchOk('{"error":"no credits"}'));

    const res = await sendCustomSms(
      { ...cfg, successText: '"sent"' },
      "912345678",
      "hi",
      "PT"
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('"sent"');
  });

  it("accepts 2xx containing the successText", async () => {
    vi.stubGlobal("fetch", fetchOk('{"sent":"ok"}'));

    const res = await sendCustomSms(
      { ...cfg, successText: '"sent"' },
      "912345678",
      "hi",
      "PT"
    );

    expect(res.success).toBe(true);
  });

  it("surfaces HTTP and network errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        text: async () => "payment required",
      }))
    );
    const res = await sendCustomSms(cfg, "912345678", "hi", "PT");
    expect(res.success).toBe(false);
    expect(res.error).toContain("402");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED")))
    );
    const res2 = await sendCustomSms(cfg, "912345678", "hi", "PT");
    expect(res2).toEqual({ error: "ECONNREFUSED", success: false });
  });
});
