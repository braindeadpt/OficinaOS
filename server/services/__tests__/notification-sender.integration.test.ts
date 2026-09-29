import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decryptWhatsAppConfig, sendWhatsApp } from "../notification-sender.js";

/**
 * Integration tests against a REAL local HTTP server emulating the
 * WhatsApp Cloud API (Graph API v21.0). No fetch mocks: the client code
 * runs its full path — URL building, headers, JSON serialization, body
 * parsing and error classification — against actual sockets.
 */

const validConfig = {
  apiToken: "ea-test-token",
  businessId: "biz-123",
  phoneNumberId: "phone-456",
};

interface IncomingBody {
  messaging_product?: string;
  text?: { body?: string };
  to?: string;
  type?: string;
}

let server: Server;
let requests: Array<{
  auth: string | null;
  body: IncomingBody | null;
  path: string;
}>;

beforeAll(async () => {
  requests = [];
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers.authorization ?? null;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: IncomingBody | null = null;
      try {
        body = JSON.parse(
          Buffer.concat(chunks).toString("utf8")
        ) as IncomingBody;
      } catch {
        body = null;
      }
      requests.push({ auth, body, path: url.pathname });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const graphError = (code: number, message: string, httpStatus: number) =>
        json(httpStatus, {
          error: {
            code,
            error_data: { details: message },
            message,
            type: "OAuthException",
          },
        });

      if (url.pathname.endsWith("/messages")) {
        if (auth !== "Bearer ea-test-token") {
          graphError(190, "Access token invalid", 401);
          return;
        }
        const to = body?.to ?? "";
        if (to === "+351900000000") {
          graphError(131_030, "Recipient phone number not in whatsapp", 404);
          return;
        }
        if (to === "+351911111111") {
          graphError(131_047, "Re-engagement message required", 400);
          return;
        }
        if (to === "+351922222222") {
          graphError(130_429, "Rate limit hit", 429);
          return;
        }
        if (to === "+351933333333") {
          res.writeHead(429, { "Content-Type": "text/plain" });
          res.end("throttled");
          return;
        }
        if (to === "+351944444444") {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("upstream exploded");
          return;
        }
        if (to === "+351955555555") {
          res.writeHead(502, { "Content-Type": "text/html" });
          res.end("<html>gateway error</html>");
          return;
        }
        json(200, { messages: [{ id: "wamid.test" }] });
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("mock server did not bind a TCP port");
  }
  process.env.WHATSAPP_GRAPH_BASE_URL = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  delete process.env.WHATSAPP_GRAPH_BASE_URL;
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  requests = [];
});

describe("sendWhatsApp integration (Graph API mock server)", () => {
  it("delivers a text message end-to-end", async () => {
    const result = await sendWhatsApp(
      validConfig,
      "0912345678",
      "Job RPR-001 is ready",
      "PT"
    );

    expect(result).toEqual({ success: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/v21.0/phone-456/messages");
    expect(requests[0].auth).toBe("Bearer ea-test-token");
    expect(requests[0].body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      text: { body: "Job RPR-001 is ready" },
      to: "+351912345678",
      type: "text",
    });
  });

  it("treats an invalid token as permanent (code 190)", async () => {
    const result = await sendWhatsApp(
      { ...validConfig, apiToken: "expired-token" },
      "0912345678",
      "Hello"
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(190);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("WhatsApp API 401");
  });

  it("treats a number not on WhatsApp as permanent (code 131030)", async () => {
    // Note: formatPhone only prepends the dial code to numbers starting
    // with 0 ("0912…" → "+351912…"); "912…" passes through untouched —
    // a known caveat, flagged for follow-up.
    const result = await sendWhatsApp(validConfig, "+351900000000", "Hello");

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(131_030);
    expect(result.retryable).toBe(false);
  });

  it("treats the 24h window violation as permanent (code 131047)", async () => {
    const result = await sendWhatsApp(validConfig, "+351911111111", "Hello");

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(131_047);
    expect(result.retryable).toBe(false);
  });

  it("marks rate limiting as retryable (code 130429, HTTP 429)", async () => {
    const result = await sendWhatsApp(validConfig, "+351922222222", "Hello");

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(130_429);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain("WhatsApp API 429");
  });

  it("classifies a plain-text 429 by status alone (retryable)", async () => {
    const result = await sendWhatsApp(validConfig, "+351933333333", "Hello");

    expect(result.success).toBe(false);
    expect(result.errorCode).toBeUndefined();
    expect(result.retryable).toBe(true);
  });

  it("classifies a 502 upstream failure as retryable", async () => {
    const result = await sendWhatsApp(validConfig, "+351944444444", "Hello");

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain("WhatsApp API 502");
  });

  it("classifies an HTML 502 error page as retryable without crashing", async () => {
    const result = await sendWhatsApp(validConfig, "+351955555555", "Hello");

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain("WhatsApp API 502");
  });

  it("keeps production endpoint when the env seam is unset", async () => {
    const saved = process.env.WHATSAPP_GRAPH_BASE_URL;
    delete process.env.WHATSAPP_GRAPH_BASE_URL;
    try {
      const result = await sendWhatsApp(validConfig, "+351999999999", "x");
      // Nothing reachable at graph.facebook.com without real credentials:
      // any failure is fine, but the error must NOT mention our mock port.
      expect(result.success).toBe(false);
      expect(result.error).not.toContain("127.0.0.1");
    } finally {
      if (saved !== undefined) {
        process.env.WHATSAPP_GRAPH_BASE_URL = saved;
      }
    }
  });
});

describe("decryptWhatsAppConfig", () => {
  it("accepts plain tokens passed through the settings row", () => {
    expect(
      decryptWhatsAppConfig({
        apiTokenEncrypted: "plain-token",
        businessId: "biz-1",
        phoneNumberId: "phone-1",
      })
    ).toEqual({
      apiToken: "plain-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
  });
});
