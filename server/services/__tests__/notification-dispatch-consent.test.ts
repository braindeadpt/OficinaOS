import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createManyAndReturnInAppNotifications: vi.fn(),
  createOutboxEntry: vi.fn(),
  findCustomerByPhone: vi.fn(),
  findManyNotificationTemplatesByName: vi.fn(),
  findManyUsers: vi.fn(),
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

vi.mock("../notification-outbox.service.js", () => ({
  queueNotification: mocks.queueNotification,
}));

import { notify } from "../notification-dispatch.js";

const app = { prisma: {} as any };

describe("notify: WHATSAPP enqueue consent gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createManyAndReturnInAppNotifications.mockResolvedValue([]);
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
      })
    );
  });
});
