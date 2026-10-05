import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findShopSettingsUnique: vi.fn(),
  decryptWhatsAppConfig: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
}));

vi.mock("../../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: mocks.findShopSettingsUnique,
}));

vi.mock("../notification-sender.js", () => ({
  decryptWhatsAppConfig: mocks.decryptWhatsAppConfig,
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));

import { runRemarketingSweep } from "../remarketing.service.js";

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as never;

const SETTINGS = {
  remarketingEnabled: true,
  whatsappEnabled: true,
  remarketingTemplate: "oficinaos_remarketing",
  remarketingDays: 90,
  remarketingCooldownDays: 180,
  whatsappApiTokenEncrypted: "enc",
  whatsappBusinessId: "biz",
  whatsappPhoneNumberId: "pnid",
  cloudEntitlements: ["remarketing"],
  shopName: "Loja Fix",
  countryCode: "PT",
};

function fakePrisma(customers: { id: string; name: string; phone: string }[]) {
  return {
    $queryRaw: vi.fn(async () => customers),
    customer: { update: vi.fn(async () => ({})) },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decryptWhatsAppConfig.mockReturnValue({ apiToken: "t" });
  mocks.sendWhatsAppTemplate.mockResolvedValue({ success: true });
});

describe("runRemarketingSweep", () => {
  it("does nothing when remarketing is disabled", async () => {
    const prisma = fakePrisma([]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...SETTINGS,
      remarketingEnabled: false,
    });
    expect(await runRemarketingSweep(prisma, log)).toBe(0);
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("does nothing without the remarketing entitlement", async () => {
    const prisma = fakePrisma([]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...SETTINGS,
      cloudEntitlements: ["whatsapp-bot"],
    });
    expect(await runRemarketingSweep(prisma, log)).toBe(0);
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("does nothing without a configured Meta template name", async () => {
    const prisma = fakePrisma([]);
    mocks.findShopSettingsUnique.mockResolvedValue({
      ...SETTINGS,
      remarketingTemplate: null,
    });
    expect(await runRemarketingSweep(prisma, log)).toBe(0);
  });

  it("sends the template to eligible customers and stamps lastRemarketingAt", async () => {
    const prisma = fakePrisma([
      { id: "c1", name: "Maria Silva", phone: "910000001" },
      { id: "c2", name: "João", phone: "910000002" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue(SETTINGS);
    const sent = await runRemarketingSweep(prisma, log);
    expect(sent).toBe(2);
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledTimes(2);
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      { apiToken: "t" },
      "910000001",
      "oficinaos_remarketing",
      "pt",
      ["Maria", "Loja Fix"],
      "PT"
    );
    expect(
      (prisma as { customer: { update: ReturnType<typeof vi.fn> } }).customer
        .update
    ).toHaveBeenCalledTimes(2);
  });

  it("marks the customer even when Meta rejects the send (no retry storm)", async () => {
    const prisma = fakePrisma([
      { id: "c1", name: "Maria Silva", phone: "910000001" },
    ]);
    mocks.findShopSettingsUnique.mockResolvedValue(SETTINGS);
    mocks.sendWhatsAppTemplate.mockResolvedValue({
      success: false,
      error: "template not found",
    });
    const sent = await runRemarketingSweep(prisma, log);
    expect(sent).toBe(0);
    expect(
      (prisma as { customer: { update: ReturnType<typeof vi.fn> } }).customer
        .update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastRemarketingAt: expect.any(Date) }),
      })
    );
  });

  it("eligibility query honours consent, cooldown and inactivity windows", async () => {
    const prisma = fakePrisma([]);
    mocks.findShopSettingsUnique.mockResolvedValue(SETTINGS);
    await runRemarketingSweep(prisma, log);
    const raw = prisma as {
      $queryRaw: ReturnType<typeof vi.fn>;
    };
    const fragments = raw.$queryRaw.mock
      .calls[0][0] as unknown as TemplateStringsArray;
    const sql = fragments.join("?");
    expect(sql).toContain('"whatsappConsent" = true');
    expect(sql).toContain("lastRemarketingAt");
    expect(sql).toContain("DELIVERED");
  });
});
