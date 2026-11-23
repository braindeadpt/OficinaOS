import { OutboxStatus } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOutboxEntry: vi.fn(),
  findCustomerByPhone: vi.fn(),
  findManyOutboxEntries: vi.fn(),
  findShopSettingsUnique: vi.fn(),
  transitionOutboxEntry: vi.fn(),
  sendWhatsApp: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  decryptWhatsAppConfig: vi.fn(),
  sendSms: vi.fn(),
  decryptSmsConfig: vi.fn(),
}));

vi.mock("../services/notification-renderer.js", () => ({
  renderTemplate: (body: string, vars: Record<string, string | number>) =>
    body.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) =>
      String(vars[k] ?? "")
    ),
}));

vi.mock("../services/notification-sender.js", () => ({
  sendWhatsApp: mocks.sendWhatsApp,
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
  decryptWhatsAppConfig: mocks.decryptWhatsAppConfig,
}));

vi.mock("../services/sms.service.js", () => ({
  sendSms: mocks.sendSms,
  decryptSmsConfig: mocks.decryptSmsConfig,
}));

vi.mock("../repositories/notification.repository.js", () => ({
  createOutboxEntry: mocks.createOutboxEntry,
  findManyOutboxEntries: mocks.findManyOutboxEntries,
  findOutboxEntryById: vi.fn(),
  transitionOutboxEntry: mocks.transitionOutboxEntry,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: mocks.findShopSettingsUnique,
}));

vi.mock("../repositories/customer.repository.js", () => ({
  findCustomerByPhone: mocks.findCustomerByPhone,
}));

const prisma = {} as any;

// Decisao 2026-11-23: todo o envio e Pro — os fixtures de envio
// precisam do entitlement "whatsapp-bot" com cache de sync fresco.
const WA_PRO = {
  cloudEntitlements: ["whatsapp-bot"],
  cloudSyncedAt: new Date(),
};

import {
  getOutboxLogs,
  processOutbox,
  queueNotification,
} from "../services/notification-outbox.service.js";

describe("queueNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an outbox entry with QUEUED status", async () => {
    mocks.createOutboxEntry.mockResolvedValue({ id: "out-1" });

    await queueNotification(prisma, {
      templateName: "job-ready",
      channel: "WHATSAPP",
      recipientPhone: "05551234567",
      templateVars: { name: "Ahmed", jobCode: "RPR-001" },
      templateBody: "Hello {{name}}, job {{jobCode}} is ready.",
    });

    expect(mocks.createOutboxEntry).toHaveBeenCalledWith(prisma, {
      channel: "WHATSAPP",
      deliverBy: null,
      job: undefined,
      recipientPhone: "05551234567",
      renderedBody: "Hello Ahmed, job RPR-001 is ready.",
      status: OutboxStatus.QUEUED,
      templateName: "job-ready",
      // Params posicionais {{1}}… na ordem dos {{var}} do corpo (o
      // template Meta aprovado consome esta ordem, §5.6) + os valores
      // por variável — uma edição aprovada entre o enqueue e o envio
      // reordena os params contra o corpo novo.
      templateParams: {
        params: ["Ahmed", "RPR-001"],
        vars: { jobCode: "RPR-001", name: "Ahmed" },
      },
    });
  });

  it("persists a delivery deadline when the payload carries one", async () => {
    mocks.createOutboxEntry.mockResolvedValue({ id: "out-3" });
    const deliverBy = new Date(Date.now() + 15 * 60_000);

    await queueNotification(prisma, {
      deliverBy,
      templateName: "signature_link",
      channel: "WHATSAPP",
      recipientPhone: "05551234567",
      templateVars: {},
      templateBody: "Sign here: {{signUrl}}",
    });

    expect(mocks.createOutboxEntry).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ deliverBy })
    );
  });

  it("passes jobId when provided", async () => {
    mocks.createOutboxEntry.mockResolvedValue({ id: "out-2" });

    await queueNotification(prisma, {
      jobId: "job-42",
      templateName: "job-ready",
      channel: "WHATSAPP",
      recipientPhone: "05551234567",
      templateVars: {},
      templateBody: "Your repair is done.",
    });

    expect(mocks.createOutboxEntry).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        job: { connect: { id: "job-42" } },
      })
    );
  });
});

describe("processOutbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends pending WHATSAPP entries and updates to SENT", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-1",
        channel: "WHATSAPP",
        recipientPhone: "05551234567",
        renderedBody: "Hello Ahmed, job RPR-001 is ready.",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.sendWhatsApp.mockResolvedValue({ success: true });
    mocks.transitionOutboxEntry.mockResolvedValue(1);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "05551234567",
      whatsappConsent: true,
    });

    await processOutbox(prisma);

    expect(mocks.findManyOutboxEntries).toHaveBeenCalledWith(
      prisma,
      {
        status: OutboxStatus.QUEUED,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: expect.any(Date) } }],
      },
      { createdAt: "asc" },
      10
    );
    expect(mocks.sendWhatsApp).toHaveBeenCalledWith(
      {
        apiToken: "decrypted-token",
        businessId: "biz-1",
        phoneNumberId: "phone-1",
      },
      "05551234567",
      "Hello Ahmed, job RPR-001 is ready.",
      "PT"
    );
    expect(mocks.findCustomerByPhone).toHaveBeenCalledWith(
      prisma,
      "05551234567"
    );
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-1",
      OutboxStatus.QUEUED,
      {
        error: null,
        sentAt: expect.any(Date),
        status: OutboxStatus.SENT,
      }
    );
  });

  it("retries with backoff when send fails on first attempt", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-2",
        channel: "WHATSAPP",
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.sendWhatsApp.mockResolvedValue({
      success: false,
      error: "WhatsApp API 403: Invalid token",
    });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "05551234567",
      whatsappConsent: true,
    });

    await processOutbox(prisma);

    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-2",
      OutboxStatus.QUEUED,
      {
        error: "WhatsApp API 403: Invalid token",
        nextRetryAt: expect.any(Date),
        retryCount: 1,
        status: OutboxStatus.QUEUED,
      }
    );
  });

  it("does nothing when no pending entries exist", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([]);

    await processOutbox(prisma);

    expect(mocks.findShopSettingsUnique).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).not.toHaveBeenCalled();
  });

  it("cancels WhatsApp entries when shop settings are missing", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-4",
        channel: "WHATSAPP",
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue(null);

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    // Sem canal resolvido o entry e cancelado — deixa-lo QUEUED
    // re-selecionava-o a cada poll de 5s para sempre.
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-4",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("unavailable"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("cancels the entry when WhatsApp credentials fail to decrypt", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-5",
        channel: "WHATSAPP",
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });
    mocks.decryptWhatsAppConfig.mockReturnValue(null);

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-5",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("unavailable"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("cancels the entry when WhatsApp is disabled even with credentials", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-6",
        channel: "WHATSAPP",
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: false,
      whatsappPhoneNumberId: "phone-1",
    });

    await processOutbox(prisma);

    expect(mocks.decryptWhatsAppConfig).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-6",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("unavailable"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("cancels a queued WHATSAPP entry when whatsapp-bot was revoked", async () => {
    // Credenciais validas e canal ligado, mas o entitlement expirou —
    // a entrada morre CANCELLED em vez de retentar ate a revogacao
    // voltar atras (comportamento definitivo, nao starvation).
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-revoked",
        channel: "WHATSAPP",
        createdAt: new Date(),
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      cloudEntitlements: [],
      cloudSyncedAt: new Date(),
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });

    await processOutbox(prisma);

    expect(mocks.decryptWhatsAppConfig).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-revoked",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("unavailable"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("sends pending SMS entries through the gateway when entitled", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-sms",
        channel: "SMS",
        recipientPhone: "0912345678",
        renderedBody: "Reparação pronta",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      cloudEntitlements: ["sms"],
      cloudSyncedAt: new Date(),
      countryCode: "PT",
      smsEnabled: true,
      smsGatewayPasswordEncrypted: "v1:enc",
      smsGatewayUrl: "http://192.168.1.50:8080",
      smsGatewayUser: "sms",
    });
    mocks.decryptSmsConfig.mockReturnValue({
      password: "p",
      url: "http://192.168.1.50:8080",
      user: "sms",
    });
    mocks.sendSms.mockResolvedValue({ success: true });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "0912345678",
      whatsappConsent: true,
    });

    await processOutbox(prisma);

    expect(mocks.sendSms).toHaveBeenCalledWith(
      { password: "p", url: "http://192.168.1.50:8080", user: "sms" },
      "0912345678",
      "Reparação pronta",
      "PT"
    );
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-sms",
      OutboxStatus.QUEUED,
      expect.objectContaining({ status: OutboxStatus.SENT })
    );
  });

  it("cancels SMS entries without the sms module (LAN is also Pro)", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-sms2",
        channel: "SMS",
        recipientPhone: "0912345678",
        renderedBody: "hi",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      cloudEntitlements: [],
      cloudSyncedAt: new Date(),
      smsEnabled: true,
      smsGatewayPasswordEncrypted: "v1:enc",
      smsGatewayUrl: "http://192.168.1.50:8080",
      smsGatewayUser: "sms",
    });
    mocks.decryptSmsConfig.mockReturnValue({
      password: "p",
      url: "http://192.168.1.50:8080",
      user: "sms",
    });
    mocks.sendSms.mockResolvedValue({ success: true });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "0912345678",
      whatsappConsent: true,
    });

    await processOutbox(prisma);

    expect(mocks.decryptSmsConfig).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-sms2",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("unavailable"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("cancels SMS entries when the module cache is stale (>24h)", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-sms-stale",
        channel: "SMS",
        recipientPhone: "0912345678",
        renderedBody: "hi",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      cloudEntitlements: ["sms"],
      cloudSyncedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      smsEnabled: true,
      smsGatewayPasswordEncrypted: "v1:enc",
      smsGatewayUrl: "http://192.168.1.50:8080",
      smsGatewayUser: "sms",
    });

    await processOutbox(prisma);

    expect(mocks.decryptSmsConfig).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-sms-stale",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("unavailable"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("cancels entries older than 24h instead of sending them", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-7",
        channel: "WHATSAPP",
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        recipientPhone: "05551234567",
        renderedBody: "Stale status update",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.transitionOutboxEntry.mockResolvedValue(1);

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-7",
      OutboxStatus.QUEUED,
      expect.objectContaining({
        error: expect.stringContaining("Expired"),
        status: OutboxStatus.CANCELLED,
      })
    );
  });

  it("cancels a signing link whose session deadline already passed", async () => {
    // Fresh entry (<24h) but past its deliverBy — a signing session dies in
    // minutes, so the generic age cutoff alone would deliver a dead link.
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-8",
        channel: "WHATSAPP",
        createdAt: new Date(),
        deliverBy: new Date(Date.now() - 60_000),
        recipientPhone: "05551234567",
        renderedBody: "Sign: https://x/sign/abc",
        retryCount: 2,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });
    mocks.transitionOutboxEntry.mockResolvedValue(1);

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-8",
      OutboxStatus.QUEUED,
      expect.objectContaining({ status: OutboxStatus.CANCELLED })
    );
  });

  it("reordena os params pelos {{var}} do corpo atual após edição aprovada", async () => {
    // Regressão Devin r8: a mensagem foi enfileirada com o corpo
    // «Cliente {{customerName}}, oficina {{shopName}}»; a loja editou
    // para «Oficina {{shopName}}, cliente {{customerName}}» e a Meta
    // aprovou a nova versão. Enviar os params na ordem antiga trocava
    // os valores («Oficina Maria, cliente Oficina Central»).
    const tplFindFirst = vi.fn(async () => ({
      body: "Oficina {{shopName}}, cliente {{customerName}}.",
    }));
    const p = {
      notificationTemplate: { findFirst: tplFindFirst },
    } as never;
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-reorder",
        channel: "WHATSAPP",
        createdAt: new Date(),
        recipientPhone: "05551234567",
        renderedBody: "Oficina Oficina Central, cliente Maria.",
        retryCount: 0,
        status: OutboxStatus.QUEUED,
        templateName: "job_ready",
        templateParams: {
          params: ["Maria", "Oficina Central"], // ordem antiga
          vars: { customerName: "Maria", shopName: "Oficina Central" },
        },
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
      whatsappTemplatesJson: { job_ready: { status: "APPROVED" } },
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.sendWhatsAppTemplate.mockResolvedValue({ success: true });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "05551234567",
      whatsappConsent: true,
    });
    mocks.transitionOutboxEntry.mockResolvedValue(1);

    await processOutbox(p);

    // Params reordenados para a versão aprovada — shopName primeiro.
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: "phone-1" }),
      "05551234567",
      "job_ready",
      "pt_PT",
      ["Oficina Central", "Maria"],
      "PT"
    );
  });

  it("params posicionais em formato antigo enviam-se tal como gravados", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-legacy",
        channel: "WHATSAPP",
        createdAt: new Date(),
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
        status: OutboxStatus.QUEUED,
        templateName: "job_ready",
        templateParams: ["A", "B"],
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
      whatsappTemplatesJson: { job_ready: { status: "APPROVED" } },
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.sendWhatsAppTemplate.mockResolvedValue({ success: true });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "05551234567",
      whatsappConsent: true,
    });
    mocks.transitionOutboxEntry.mockResolvedValue(1);

    await processOutbox(prisma);

    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.anything(),
      "05551234567",
      "job_ready",
      "pt_PT",
      ["A", "B"],
      "PT"
    );
  });

  it("modo local envia o template pelo nome sem exigir APPROVED (Pro local)", async () => {
    // Sem sync local, o estado persistido não existe — a app manda o
    // template na mesma e a Meta rejeita o que faltar como erro normal.
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-local-tpl",
        channel: "WHATSAPP",
        createdAt: new Date(),
        recipientPhone: "05551234567",
        renderedBody: "Hello",
        retryCount: 0,
        status: OutboxStatus.QUEUED,
        templateName: "job_ready",
        templateParams: ["A"],
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
      // Estado PENDING persistido — ignorado em modo local.
      whatsappTemplatesJson: { job_ready: { status: "PENDING" } },
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.sendWhatsAppTemplate.mockResolvedValue({ success: true });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "05551234567",
      whatsappConsent: true,
    });
    mocks.transitionOutboxEntry.mockResolvedValue(1);

    await processOutbox(prisma);

    // Envia pelo nome — não adia por causa do estado persistido.
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.anything(),
      "05551234567",
      "job_ready",
      "pt_PT",
      ["A"],
      "PT"
    );
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      prisma,
      "out-local-tpl",
      OutboxStatus.QUEUED,
      expect.objectContaining({ status: OutboxStatus.SENT })
    );
  });

  it("still sends an entry whose deliverBy is in the future", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        id: "out-9",
        channel: "WHATSAPP",
        createdAt: new Date(),
        deliverBy: new Date(Date.now() + 10 * 60_000),
        recipientPhone: "05551234567",
        renderedBody: "Sign: https://x/sign/abc",
        retryCount: 0,
      },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...WA_PRO,
      countryCode: "PT",
      whatsappApiTokenEncrypted: "enc-token",
      whatsappBusinessId: "biz-1",
      whatsappEnabled: true,
      whatsappPhoneNumberId: "phone-1",
    });
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "decrypted-token",
      businessId: "biz-1",
      phoneNumberId: "phone-1",
    });
    mocks.sendWhatsApp.mockResolvedValue({ success: true });
    mocks.transitionOutboxEntry.mockResolvedValue(1);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "05551234567",
      whatsappConsent: true,
    });

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).toHaveBeenCalledOnce();
  });
});

describe("getOutboxLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns outbox entries ordered by createdAt desc", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    mocks.findManyOutboxEntries.mockResolvedValue([
      {
        channel: "WHATSAPP",
        createdAt: now,
        error: null,
        id: "out-2",
        jobId: "job-2",
        nextRetryAt: null,
        recipientPhone: "05551111111",
        renderedBody: "Recent",
        retryCount: 0,
        status: OutboxStatus.SENT,
        templateName: "job-ready",
      },
      {
        channel: "WHATSAPP",
        createdAt: earlier,
        error: "Send failed: rate limited",
        id: "out-1",
        jobId: null,
        nextRetryAt: null,
        recipientPhone: "05550000000",
        renderedBody: "Older",
        retryCount: 3,
        status: OutboxStatus.FAILED,
        templateName: "job-delayed",
      },
    ]);

    const logs = await getOutboxLogs(prisma);

    expect(mocks.findManyOutboxEntries).toHaveBeenCalledWith(
      prisma,
      {},
      { createdAt: "desc" },
      50
    );
    expect(logs).toHaveLength(2);
    expect(logs[0]).toEqual({
      channel: "WHATSAPP",
      createdAt: now,
      error: null,
      id: "out-2",
      jobId: "job-2",
      nextRetryAt: null,
      renderedBody: "Recent",
      recipientPhone: "05551111111",
      retryCount: 0,
      status: OutboxStatus.SENT,
      templateName: "job-ready",
    });
    expect(logs[1]).toEqual({
      channel: "WHATSAPP",
      createdAt: earlier,
      error: "Send failed: rate limited",
      id: "out-1",
      jobId: null,
      nextRetryAt: null,
      renderedBody: "Older",
      recipientPhone: "05550000000",
      retryCount: 3,
      status: OutboxStatus.FAILED,
      templateName: "job-delayed",
    });
  });

  it("respects custom limit", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([]);

    await getOutboxLogs(prisma, 10);

    expect(mocks.findManyOutboxEntries).toHaveBeenCalledWith(
      prisma,
      {},
      { createdAt: "desc" },
      10
    );
  });
});
