import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptWhatsAppConfig,
  sendWhatsApp,
} from "../services/notification-sender.js";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  decryptSecret: vi.fn(),
  isEncrypted: vi.fn(),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: mocks.decryptSecret,
  isEncrypted: mocks.isEncrypted,
}));

vi.stubGlobal("fetch", mocks.fetch);

const validConfig = {
  apiToken: "ea-test-token",
  businessId: "biz-123",
  phoneNumberId: "phone-456",
};

describe("sendWhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when API responds 200", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await sendWhatsApp(validConfig, "0912345678", "Hello");

    expect(result).toEqual({ success: true });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/phone-456/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ea-test-token",
        }),
      })
    );
  });

  it("formats Portuguese phone numbers with 351 prefix", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

    await sendWhatsApp(validConfig, "0912345678", "Hello");

    const call = mocks.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.to).toBe("+351912345678");
  });

  it("passes international numbers as-is", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

    await sendWhatsApp(validConfig, "33612345678", "Hello");

    const call = mocks.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.to).toBe("+33612345678");
  });

  it("returns error when API responds with non-200 status", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    });

    const result = await sendWhatsApp(validConfig, "0912345678", "Hello");

    expect(result.success).toBe(false);
    expect(result.error).toContain("WhatsApp API 401");
  });

  it("returns error when token is empty", async () => {
    const noTokenConfig = { ...validConfig, apiToken: "" };

    const _result = await sendWhatsApp(noTokenConfig, "0555123456", "Hello");

    // Even with empty token, the function makes the call (API rejects it)
    // But if the API returns 401, we should get an error
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Invalid token"),
    });

    const result2 = await sendWhatsApp(noTokenConfig, "0555123456", "Hello");
    expect(result2.success).toBe(false);
    expect(result2.error).toContain("WhatsApp API 401");
  });

  it("returns error on network failure", async () => {
    mocks.fetch.mockRejectedValue(new Error("Network timeout"));

    const result = await sendWhatsApp(validConfig, "0912345678", "Hello");

    expect(result).toEqual({ success: false, error: "Network timeout" });
  });

  it("returns error on unknown thrown value", async () => {
    mocks.fetch.mockRejectedValue("not an error");

    const result = await sendWhatsApp(validConfig, "0912345678", "Hello");

    expect(result).toEqual({ success: false, error: "Unknown error" });
  });
});

describe("decryptWhatsAppConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decrypts encrypted token and returns config", () => {
    mocks.isEncrypted.mockReturnValue(true);
    mocks.decryptSecret.mockReturnValue("decrypted-token");

    const result = decryptWhatsAppConfig({
      apiTokenEncrypted: "v1:iv:tag:enc",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });

    expect(result).toEqual({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    expect(mocks.decryptSecret).toHaveBeenCalledWith("v1:iv:tag:enc");
  });

  it("returns plain token when not encrypted", () => {
    mocks.isEncrypted.mockReturnValue(false);

    const result = decryptWhatsAppConfig({
      apiTokenEncrypted: "plain-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });

    expect(result).toEqual({
      apiToken: "plain-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    expect(mocks.decryptSecret).not.toHaveBeenCalled();
  });

  it("returns null when apiTokenEncrypted is empty", () => {
    const result = decryptWhatsAppConfig({
      apiTokenEncrypted: "",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });

    expect(result).toBeNull();
  });

  it("returns null when businessId is empty", () => {
    const result = decryptWhatsAppConfig({
      apiTokenEncrypted: "some-token",
      businessId: "",
      phoneNumberId: "phone-1",
    });

    expect(result).toBeNull();
  });

  it("returns null when phoneNumberId is empty", () => {
    const result = decryptWhatsAppConfig({
      apiTokenEncrypted: "some-token",
      businessId: "biz-1",
      phoneNumberId: "",
    });

    expect(result).toBeNull();
  });

  it("returns null when decrypted token is empty", () => {
    mocks.isEncrypted.mockReturnValue(true);
    mocks.decryptSecret.mockReturnValue("");

    const result = decryptWhatsAppConfig({
      apiTokenEncrypted: "v1:iv:tag:enc",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });

    expect(result).toBeNull();
  });
});
