import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createManyAndReturnInAppNotifications: vi.fn(),
  createOutboxEntry: vi.fn(),
  findCustomerByPhone: vi.fn(),
  findManyNotificationTemplatesByName: vi.fn(),
  findManyUsers: vi.fn(),
  findShopSettingsUnique: vi.fn(),
  queueNotification: vi.fn(),
}));

vi.mock("../../repositories/customer.repository.js", () => ({
  findCustomerByPhone: mocks.findCustomerByPhone,
}));

vi.mock("../../repositories/notification.repository.js", () => ({
  createManyAndReturnInAppNotifications:
    mocks.createManyAndReturnInAppNotifications,
  createOutboxEntry: mocks.createOutboxEntry,
  findManyNotificationTemplatesByName:
    mocks.findManyNotificationTemplatesByName,
  findManyUsers: mocks.findManyUsers,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: mocks.findShopSettingsUnique,
}));

vi.mock("../notification-outbox.service.js", () => ({
  queueNotification: mocks.queueNotification,
  STAFF_INITIATED_TEMPLATES: new Set(["signature_link"]),
}));

import { notify } from "../notification-dispatch.js";

const app = { prisma: {} as any };

// Decisão 2026-11-23: todo o envio é Pro — as shops de teste precisam
// dos entitlements frescos para o dispatch enfileirar WA/SMS.
const PRO_SHOP = {
  cloudEntitlements: ["sms", "whatsapp-bot"],
  cloudSyncedAt: new Date(),
};

describe("notify: WHATSAPP enqueue consent gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createManyAndReturnInAppNotifications.mockResolvedValue([]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...PRO_SHOP,
      shopName: "Loja Teste",
      whatsappEnabled: true,
    });
    mocks.queueNotification.mockResolvedValue(undefined);
  });

  it("skips the outbox when the customer has no WhatsApp consent", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: false,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_ready",
      jobId: "job-1",
      recipients: {},
    });

    expect(mocks.queueNotification).not.toHaveBeenCalled();
  });

  it("queues the WhatsApp message when consent is granted", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_ready",
      jobId: "job-1",
      recipients: {},
    });

    expect(mocks.queueNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "WHATSAPP",
        recipientPhone: "+351910000001",
        templateVars: expect.objectContaining({ shopName: "Loja Teste" }),
      })
    );
  });

  it("injects the real shopName into template vars for all channels", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      {
        body: "Repair done{{if shopName}} — {{shopName}}{{endif}}",
        channel: "WHATSAPP",
      },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_done",
      recipients: {},
    });

    expect(mocks.queueNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateVars: expect.objectContaining({
          customerName: "Ana",
          shopName: "Loja Teste",
        }),
      })
    );
  });

  it("omits shopName when the shop settings has none", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...PRO_SHOP,
      whatsappEnabled: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_done",
      recipients: {},
    });

    const call = mocks.queueNotification.mock.calls[0];
    expect(call[1].templateVars).not.toHaveProperty("shopName");
  });

  it("lets the event context override the settings shopName", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}} from {{shopName}}", channel: "WHATSAPP" },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: {
        customerName: "Ana",
        recipientPhone: "+351910000001",
        shopName: "Override",
      },
      eventName: "job_done",
      recipients: {},
    });

    const call = mocks.queueNotification.mock.calls[0];
    expect(call[1].templateVars.shopName).toBe("Override");
  });

  it("does not enqueue WhatsApp without the whatsapp-bot module", async () => {
    // Canal ligado e consentido, mas sem entitlement — grátis não envia.
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      cloudEntitlements: [],
      cloudSyncedAt: new Date(),
      shopName: "Loja Teste",
      whatsappEnabled: true,
    });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_done",
      recipients: {},
    });

    expect(mocks.queueNotification).not.toHaveBeenCalled();
  });

  it("does not enqueue SMS without the sms module (fallback included)", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      cloudEntitlements: ["whatsapp-bot"],
      cloudSyncedAt: new Date(),
      shopName: "Loja Teste",
      smsEnabled: true,
      whatsappEnabled: true,
    });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_done",
      recipients: {},
    });

    // WHATSAPP enfileira (módulo ativo) — SMS e o fallback não.
    const channels = mocks.queueNotification.mock.calls.map(
      (c) => c[1].channel
    );
    expect(channels).toEqual(["WHATSAPP"]);
  });

  it("does not enqueue WhatsApp when the channel is disabled", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...PRO_SHOP,
      // Só whatsapp-bot — sem o módulo "sms" o fallback SMS não corre,
      // senão o teste media o fallback e não o toggle WhatsApp.
      cloudEntitlements: ["whatsapp-bot"],
      shopName: "Loja Teste",
      whatsappEnabled: false,
    });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_done",
      recipients: {},
    });

    expect(mocks.queueNotification).not.toHaveBeenCalled();
  });

  it("adds a trackingUrl built from the shop tracking base URL", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...PRO_SHOP,
      shopName: "Loja Teste",
      trackingBaseUrl: "https://loja.example.com/",
      whatsappEnabled: true,
    });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351 910 000 001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: {
        customerName: "Ana",
        jobCode: "RPR-2026-0001",
        recipientPhone: "+351 910 000 001",
      },
      eventName: "job_done",
      recipients: {},
    });

    expect(mocks.queueNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateVars: expect.objectContaining({
          trackingUrl:
            "https://loja.example.com/tracking/RPR-2026-0001?phone4=0001",
        }),
      })
    );
  });

  it("omits trackingUrl when no tracking base URL is configured", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: {
        customerName: "Ana",
        jobCode: "RPR-2026-0001",
        recipientPhone: "+351910000001",
      },
      eventName: "job_done",
      recipients: {},
    });

    const call = mocks.queueNotification.mock.calls[0];
    expect(call[1].templateVars).not.toHaveProperty("trackingUrl");
  });

  it("injects the shop reviewUrl into template vars", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...PRO_SHOP,
      reviewUrl: "https://g.page/r/abc123/review",
      shopName: "Loja Teste",
      whatsappEnabled: true,
    });
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_delivered",
      recipients: {},
    });

    expect(mocks.queueNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateVars: expect.objectContaining({
          reviewUrl: "https://g.page/r/abc123/review",
        }),
      })
    );
  });

  it("omits reviewUrl when the shop has none configured", async () => {
    mocks.findManyNotificationTemplatesByName.mockResolvedValue([
      { body: "hi {{customerName}}", channel: "WHATSAPP" },
    ]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });

    await notify(app, {
      context: { customerName: "Ana", recipientPhone: "+351910000001" },
      eventName: "job_delivered",
      recipients: {},
    });

    const call = mocks.queueNotification.mock.calls[0];
    expect(call[1].templateVars).not.toHaveProperty("reviewUrl");
  });
});
