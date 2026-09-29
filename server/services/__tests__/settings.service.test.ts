import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAiSettings,
  getNotificationTemplates,
  getShopSettings,
  testAiConnection,
  updateNotificationTemplate,
  upsertAiSettings,
  upsertShopSettings,
} from "../settings.service";

function mockPrisma() {
  return {
    aiSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    shopSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    notificationTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

// Mock global fetch
global.fetch = vi.fn();

describe("getAiSettings", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns AI settings", async () => {
    (
      prisma.aiSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      apiKeyEncrypted: "encrypted-key",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      id: "default",
      model: "gpt-4",
      temperature: 0.7,
    });

    const result = await getAiSettings(prisma);

    expect(result).toHaveProperty("id", "default");
    expect(result).toHaveProperty("model", "gpt-4");
  });
});

describe("upsertAiSettings", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("upserts AI settings with id 'default'", async () => {
    (prisma.aiSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      endpointUrl: "https://api.example.com",
      id: "default",
      model: "gpt-3.5",
    });

    const result = await upsertAiSettings(prisma, {
      endpointUrl: "https://api.example.com",
      model: "gpt-3.5",
    });

    const upsertCall = (prisma.aiSettings.upsert as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(upsertCall[0].where).toEqual({ id: "default" });
    expect(result).toHaveProperty("id", "default");
  });

  it("encrypts apiKey when provided and never returns the plaintext", async () => {
    (prisma.aiSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      apiKeyEncrypted: "v1:iv:tag:ciphertext",
      endpointUrl: "https://api.example.com",
      id: "default",
    });

    const result = await upsertAiSettings(prisma, {
      apiKey: "new-api-key",
      endpointUrl: "https://api.example.com",
    });

    const upsertCall = (prisma.aiSettings.upsert as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    const stored = upsertCall[0].update.apiKeyEncrypted as string;
    expect(stored).not.toBe("new-api-key");
    expect(stored.startsWith("v1:")).toBe(true);
    // Response exposes only a boolean, never the ciphertext
    expect(result).not.toHaveProperty("apiKeyEncrypted");
    expect((result as { hasApiKey: boolean }).hasApiKey).toBe(true);
  });

  it("treats empty apiKey as no-change to avoid wiping the stored key", async () => {
    (prisma.aiSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      apiKeyEncrypted: "v1:iv:tag:existing",
      endpointUrl: "https://api.example.com",
      id: "default",
    });

    await upsertAiSettings(prisma, {
      apiKey: "",
      endpointUrl: "https://api.example.com",
    });

    const upsertCall = (prisma.aiSettings.upsert as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(upsertCall[0].update).not.toHaveProperty("apiKeyEncrypted");
  });
});

describe("getShopSettings", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns shop settings", async () => {
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      address: "123 Main St",
      currency: "EUR",
      id: "default",
      phone: "+351912345678",
      shopName: "TechFix Repair",
    });

    const result = await getShopSettings(prisma);

    expect(result).toHaveProperty("shopName", "TechFix Repair");
    expect(result).toHaveProperty("currency", "EUR");
  });
});

describe("upsertShopSettings", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("upserts shop settings", async () => {
    (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "default",
      shopName: "New Shop",
    });

    const result = await upsertShopSettings(prisma, { shopName: "New Shop" });

    expect(result).toHaveProperty("shopName", "New Shop");
  });

  it("uses defaults for create", async () => {
    (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      {}
    );

    await upsertShopSettings(prisma, { shopName: "Test Shop" });

    const upsertCall = (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(upsertCall[0].create.currency).toBe("EUR");
  });
});

describe("getNotificationTemplates", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns templates ordered by createdAt desc", async () => {
    const mockTemplates = [
      {
        body: "Template 1",
        channel: "WHATSAPP",
        createdAt: new Date(),
        id: "1",
        name: "Welcome",
      },
      {
        body: "Template 2",
        channel: "IN_APP",
        createdAt: new Date(),
        id: "2",
        name: "Reminder",
      },
    ];
    (
      prisma.notificationTemplate.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockTemplates);

    const result = await getNotificationTemplates(prisma);

    expect(result).toHaveLength(2);
    const findManyCall = (
      prisma.notificationTemplate.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(findManyCall[0].orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("updateNotificationTemplate", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when template not found", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const result = await updateNotificationTemplate(prisma, "non-existent", {
      body: "New body",
      channel: "WHATSAPP",
      isDefault: true,
      name: "Test",
    });

    expect(result).toBeNull();
  });

  it("updates template with provided data", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "template-1",
      name: "Old Name",
    });
    (
      prisma.notificationTemplate.update as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      body: "Updated body",
      channel: "WHATSAPP",
      id: "template-1",
      isDefault: true,
      name: "Updated Name",
    });

    const result = await updateNotificationTemplate(prisma, "template-1", {
      body: "Updated body",
      channel: "WHATSAPP",
      isDefault: true,
      name: "Updated Name",
    });

    expect(result).toHaveProperty("name", "Updated Name");
    expect(result).toHaveProperty("body", "Updated body");
  });
});

describe("testAiConnection", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    vi.clearAllMocks();
  });

  it("returns failure when settings not configured", async () => {
    (
      prisma.aiSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const result = await testAiConnection(prisma);

    expect(result.success).toBe(false);
    expect(result.message).toBe("AI settings not configured");
  });

  it("returns failure when endpoint URL is not set", async () => {
    (
      prisma.aiSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      apiKeyEncrypted: "key",
      endpointUrl: "",
    });

    const result = await testAiConnection(prisma);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Endpoint URL is not set");
  });

  it("returns success on successful connection", async () => {
    (
      prisma.aiSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      apiKeyEncrypted: "test-key",
      endpointUrl: "https://api.example.com",
      model: "gpt-4",
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });

    const result = await testAiConnection(prisma);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Connection successful");
  });

  it("returns failure on HTTP error", async () => {
    (
      prisma.aiSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      apiKeyEncrypted: "test-key",
      endpointUrl: "https://api.example.com",
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const result = await testAiConnection(prisma);

    expect(result.success).toBe(false);
    expect(result.message).toContain("401");
  });

  it("returns failure on network error", async () => {
    (
      prisma.aiSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      apiKeyEncrypted: "test-key",
      endpointUrl: "https://api.example.com",
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error")
    );

    const result = await testAiConnection(prisma);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Network error");
  });
});
