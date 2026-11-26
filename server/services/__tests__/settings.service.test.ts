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
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    aiSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    shopSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    notificationOutbox: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    notificationTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return prisma as unknown as PrismaClient;
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

  it("increments terms version and date when the legal text changes", async () => {
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "default",
      intakeTerms: "Termos antigos",
      intakeTermsUpdatedAt: new Date("2026-01-01T00:00:00Z"),
      intakeTermsVersion: 3,
    });
    (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      {}
    );

    await upsertShopSettings(prisma, { intakeTerms: "Termos novos" });

    const update = (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0].update;
    expect(update.intakeTermsVersion).toBe(4);
    expect(update.intakeTermsUpdatedAt).toBeInstanceOf(Date);
  });

  it("does not increment the version when unrelated settings change", async () => {
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "default",
      intakeTerms: "Termos antigos",
      intakeTermsVersion: 3,
    });
    (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      {}
    );

    await upsertShopSettings(prisma, { shopName: "Outra loja" });

    const update = (prisma.shopSettings.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0].update;
    expect(update).not.toHaveProperty("intakeTermsVersion");
    expect(update).not.toHaveProperty("intakeTermsUpdatedAt");
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

  it("rename migra entradas QUEUED quando o nome antigo não está aprovado", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-1",
      name: "job_ready",
    });
    (
      prisma.notificationTemplate.update as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-1",
      name: "job_ready_v2",
    });
    // Nome antigo ainda em revisão — sem aprovação Meta registada.
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      whatsappTemplatesJson: { job_ready: { status: "PENDING" } },
    });
    (
      prisma.notificationOutbox.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      // vars → migra (o envio recomputa a ordem pelo corpo atual)
      {
        id: "o1",
        templateParams: { params: ["Ana"], vars: { customer: "Ana" } },
      },
      // legado só-posicional → fica sob o nome antigo (Meta mantém)
      { id: "o2", templateParams: ["Ana", "RPR-1"] },
      // texto livre → migra — o nome tem de existir na Meta
      { id: "o3", templateParams: null },
    ]);

    await updateNotificationTemplate(prisma, "template-1", {
      body: "B",
      channel: "WHATSAPP",
      isDefault: true,
      name: "job_ready_v2",
    });

    expect(prisma.notificationOutbox.findMany).toHaveBeenCalledWith({
      select: { id: true, templateParams: true },
      where: {
        channel: "WHATSAPP",
        status: "QUEUED",
        templateName: "job_ready",
      },
    });
    expect(prisma.notificationOutbox.update).toHaveBeenCalledTimes(2);
    // Migradas com nextRetryAt/error limpos — um nome já aprovado não
    // espera o ciclo de adiamento.
    expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
      data: {
        error: null,
        nextRetryAt: null,
        templateName: "job_ready_v2",
      },
      where: { id: "o1" },
    });
    expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
      data: {
        error: null,
        nextRetryAt: null,
        templateName: "job_ready_v2",
      },
      where: { id: "o3" },
    });
  });

  it("rename com nome antigo APPROVED não migra — a fila drena pela Meta", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-1",
      name: "job_ready",
    });
    (
      prisma.notificationTemplate.update as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-1",
      name: "job_ready_v2",
    });
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      whatsappTemplatesJson: { job_ready: { status: "APPROVED" } },
    });

    await updateNotificationTemplate(prisma, "template-1", {
      body: "B",
      channel: "WHATSAPP",
      isDefault: true,
      name: "job_ready_v2",
    });

    expect(prisma.notificationOutbox.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationOutbox.update).not.toHaveBeenCalled();
  });

  it("rename para nome reservado (signature_link) é rejeitado", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-1",
      name: "job_ready",
    });

    await expect(
      updateNotificationTemplate(prisma, "template-1", {
        body: "B",
        channel: "WHATSAPP",
        isDefault: true,
        name: "signature_link",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.notificationTemplate.update).not.toHaveBeenCalled();
  });

  it("modelo signature_link edita o corpo sem mudar o nome", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-sig",
      name: "signature_link",
    });
    (
      prisma.notificationTemplate.update as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      body: "novo texto {{signUrl}}",
      channel: "WHATSAPP",
      id: "template-sig",
      name: "signature_link",
    });

    const result = await updateNotificationTemplate(prisma, "template-sig", {
      body: "novo texto {{signUrl}}",
      channel: "WHATSAPP",
      isDefault: true,
      name: "signature_link",
    });

    expect(result).toHaveProperty("body", "novo texto {{signUrl}}");
  });

  it("modelo signature_link sem {{signUrl}} no corpo é rejeitado", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      body: "texto antigo {{signUrl}}",
      channel: "WHATSAPP",
      id: "template-sig",
      name: "signature_link",
    });

    await expect(
      updateNotificationTemplate(prisma, "template-sig", {
        body: "novo texto sem a ligação",
        channel: "WHATSAPP",
        isDefault: true,
        name: "signature_link",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.notificationTemplate.update).not.toHaveBeenCalled();
  });

  it("confirmação IN_APP de signature_link não exige {{signUrl}}", async () => {
    // O modelo IN_APP é a confirmação para o staff ("link enviado a…"),
    // deliberadamente sem ligação — a variável só é obrigatória nos
    // canais que entregam ao cliente.
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "IN_APP",
      id: "template-sig-inapp",
      name: "signature_link",
    });
    (
      prisma.notificationTemplate.update as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      body: "Link enviado a {{customerName}}",
      channel: "IN_APP",
      id: "template-sig-inapp",
      name: "signature_link",
    });

    const result = await updateNotificationTemplate(
      prisma,
      "template-sig-inapp",
      {
        body: "Link enviado a {{customerName}}",
        channel: "IN_APP",
        isDefault: false,
        name: "signature_link",
      }
    );

    expect(result).toHaveProperty("body", "Link enviado a {{customerName}}");
  });

  it("rename + mudança de canal não migra a fila WHATSAPP", async () => {
    (
      prisma.notificationTemplate.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "WHATSAPP",
      id: "template-1",
      name: "job_ready",
    });
    (
      prisma.notificationTemplate.update as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      channel: "SMS",
      id: "template-1",
      name: "job_ready_sms",
    });
    (
      prisma.shopSettings.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    await updateNotificationTemplate(prisma, "template-1", {
      body: "B",
      channel: "SMS",
      isDefault: true,
      name: "job_ready_sms",
    });

    expect(prisma.notificationOutbox.findMany).not.toHaveBeenCalled();
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

describe("AI provider changes", () => {
  it("clears the previous provider key and disables AI when changing host without a new key", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.aiSettings.findUnique).mockResolvedValue({
      endpointUrl: "https://api.openai.com/v1",
      apiKeyEncrypted: "old-provider-secret",
    } as never);
    vi.mocked(prisma.aiSettings.upsert).mockResolvedValue({
      apiKeyEncrypted: "",
      enabled: false,
    } as never);
    await upsertAiSettings(prisma, {
      endpointUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      enabled: true,
    });
    expect(prisma.aiSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          apiKeyEncrypted: "",
          enabled: false,
        }),
      })
    );
  });
  it("keeps a stored key when saving the same provider", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.aiSettings.findUnique).mockResolvedValue({
      endpointUrl: "https://api.openai.com/v1",
      apiKeyEncrypted: "old-provider-secret",
    } as never);
    await upsertAiSettings(prisma, {
      endpointUrl: "https://api.openai.com/v1/",
      model: "gpt-4o-mini",
    });
    expect(
      vi.mocked(prisma.aiSettings.upsert).mock.calls[0]?.[0].update
    ).not.toHaveProperty("apiKeyEncrypted");
  });
  it("probes the Gemini chat endpoint with its own key", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.aiSettings.findUnique).mockResolvedValue({
      endpointUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKeyEncrypted: "gemini-key",
      model: "gemini-3.5-flash-lite",
    } as never);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
    expect((await testAiConnection(prisma)).success).toBe(true);
    expect(global.fetch).toHaveBeenLastCalledWith(
      new URL(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      ),
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer gemini-key",
        },
      })
    );
  });
});
