import { OutboxStatus } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOutboxEntry: vi.fn(),
  decryptWhatsAppConfig: vi.fn(),
  findCustomerByPhone: vi.fn(),
  findManyOutboxEntries: vi.fn(),
  findShopSettingsUnique: vi.fn(),
  sendWhatsApp: vi.fn(),
  transitionOutboxEntry: vi.fn(),
}));

vi.mock("../../repositories/customer.repository.js", () => ({
  findCustomerByPhone: mocks.findCustomerByPhone,
}));

vi.mock("../../repositories/notification.repository.js", () => ({
  createOutboxEntry: mocks.createOutboxEntry,
  findManyOutboxEntries: mocks.findManyOutboxEntries,
  findNotificationTemplateUnique: vi.fn(),
  findOutboxEntryById: vi.fn(),
  transitionOutboxEntry: mocks.transitionOutboxEntry,
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: mocks.findShopSettingsUnique,
}));

vi.mock("../notification-renderer.js", () => ({
  renderTemplate: (body: string) => body,
}));

vi.mock("../notification-sender.js", () => ({
  decryptWhatsAppConfig: mocks.decryptWhatsAppConfig,
  sendWhatsApp: mocks.sendWhatsApp,
}));

import {
  assertWhatsAppConsent,
  processOutbox,
} from "../notification-outbox.service.js";

const prisma = {} as any;

describe("assertWhatsAppConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the shop's own phone without a customer record", async () => {
    const err = await assertWhatsAppConsent(
      prisma,
      "+351910000000",
      "+351910000000"
    );
    expect(err).toBeNull();
    expect(mocks.findCustomerByPhone).not.toHaveBeenCalled();
  });

  it("blocks phones without a customer record", async () => {
    mocks.findCustomerByPhone.mockResolvedValue(null);
    const err = await assertWhatsAppConsent(prisma, "+351910000001", null);
    expect(err).toContain("no customer record");
  });

  it("blocks customers without consent", async () => {
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: false,
    });
    const err = await assertWhatsAppConsent(prisma, "+351910000001", null);
    expect(err).toContain("consent");
  });

  it("allows customers with consent granted", async () => {
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });
    const err = await assertWhatsAppConsent(prisma, "+351910000001", null);
    expect(err).toBeNull();
  });
});

describe("processOutbox consent enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transitionOutboxEntry.mockResolvedValue(1);
    mocks.decryptWhatsAppConfig.mockReturnValue({
      apiToken: "tok",
      businessId: "biz",
      phoneNumberId: "pnid",
    });
    mocks.findShopSettingsUnique.mockResolvedValue({
      countryCode: "PT",
      phone: "+351910000000",
      whatsappApiTokenEncrypted: "tok",
      whatsappBusinessId: "biz",
      whatsappPhoneNumberId: "pnid",
      whatsappEnabled: true,
    });
  });

  function pendingEntry(overrides: Record<string, unknown> = {}) {
    return {
      channel: "WHATSAPP",
      createdAt: new Date(),
      error: null,
      id: "entry-1",
      jobId: null,
      nextRetryAt: null,
      recipientPhone: "+351910000001",
      renderedBody: "hello",
      retryCount: 0,
      status: OutboxStatus.QUEUED,
      templateName: "job_ready",
      ...overrides,
    };
  }

  it("cancels the entry instead of sending when consent is missing", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([pendingEntry()]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: false,
    });
    mocks.sendWhatsApp.mockResolvedValue({ success: true });

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      expect.anything(),
      "entry-1",
      OutboxStatus.QUEUED,
      expect.objectContaining({ status: OutboxStatus.CANCELLED })
    );
  });

  it("sends normally when the customer has consent", async () => {
    mocks.findManyOutboxEntries.mockResolvedValue([pendingEntry()]);
    mocks.findCustomerByPhone.mockResolvedValue({
      phone: "+351910000001",
      whatsappConsent: true,
    });
    mocks.sendWhatsApp.mockResolvedValue({ success: true });

    await processOutbox(prisma);

    expect(mocks.sendWhatsApp).toHaveBeenCalled();
    expect(mocks.transitionOutboxEntry).toHaveBeenCalledWith(
      expect.anything(),
      "entry-1",
      OutboxStatus.QUEUED,
      expect.objectContaining({ status: OutboxStatus.SENT })
    );
  });
});
