import { buildLoanerAgreementDocument } from "@shared/loaner-agreement-document.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "../config/env.js";
import {
  SIGNATURE_LINK_EVENT,
  sendSignatureLink,
} from "../services/signature-link.service.js";

const mocks = vi.hoisted(() => ({
  getSmsDeviceStatus: vi.fn(
    async (): Promise<{
      configured: boolean;
      device: null;
      entitled: boolean;
      reachable: boolean;
      sendable: boolean;
    }> => ({
      configured: false,
      device: null,
      entitled: false,
      reachable: false,
      sendable: false,
    })
  ),
}));

// Só o device-status é mockado — o resto do pipeline (notify → outbox)
// corre contra o prisma stub, como nos outros testes deste ficheiro.
vi.mock("../services/sms-cloud.service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../services/sms-cloud.service.js")
  >()),
  getSmsDeviceStatus: mocks.getSmsDeviceStatus,
}));

// The staff-initiated send dispatches through the REAL notify() pipeline —
// the prisma stub below exercises the whole chain (templates → consent
// bypass → outbox enqueue → audit), not a mocked notification service.

const TOKEN = "a".repeat(64);
const PHONE = "+351 912 345 678";

function intakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    token: TOKEN,
    relayed: false,
    signatureDataUrl: null,
    expiresAt: new Date(Date.now() + 15 * 60_000),
    snapshot: {
      v: 1,
      customerName: "Ana Silva",
      customerPhone: PHONE,
      problem: "Broken screen",
    },
    ...overrides,
  };
}

function loanerJob() {
  return {
    id: "job-1",
    jobCode: "REP-0042",
    createdAt: new Date("2026-01-10T10:00:00Z"),
    estimatedDate: new Date("2026-01-15T10:00:00Z"),
    imei: null,
    loanerNote: null,
    customer: { name: "Ana Silva", phone: PHONE, taxId: null },
    device: { brand: { name: "Apple" }, model: "iPhone 13" },
    loanerDevice: {
      label: "Emprestimo 3",
      brand: "Samsung",
      model: "A54",
      imei: "3567",
    },
  };
}

function loanerSession(overrides: Record<string, unknown> = {}) {
  const job = loanerJob();
  return {
    id: "sess-2",
    token: TOKEN,
    relayed: true,
    signatureDataUrl: null,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    snapshot: buildLoanerAgreementDocument(job, "pt"),
    ...overrides,
  };
}

function stubPrisma() {
  return {
    signatureSession: { findUnique: vi.fn() },
    shopSettings: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
    notificationTemplate: { findMany: vi.fn() },
    inAppNotification: { createManyAndReturn: vi.fn() },
    customer: { findUnique: vi.fn() },
    notificationOutbox: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

function defaultSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "default",
    cloudApiUrl: "https://cloud.example.com",
    trackingBaseUrl: null,
    whatsappEnabled: true,
    smsEnabled: false,
    cloudEntitlements: {},
    shopName: "Oficina XPTO",
    currency: "EUR",
    ...overrides,
  };
}

const WA_TEMPLATE = {
  channel: "WHATSAPP",
  body: "Olá {{customerName}}, assine {{docLabel}}: {{signUrl}} ({{ttlMinutes}} min)",
};
const IN_APP_TEMPLATE = {
  channel: "IN_APP",
  body: "Link enviado a {{customerName}}",
};

function wireHappyPath(prisma: ReturnType<typeof stubPrisma>) {
  prisma.notificationTemplate.findMany.mockResolvedValue([
    IN_APP_TEMPLATE,
    WA_TEMPLATE,
  ]);
  prisma.inAppNotification.createManyAndReturn.mockResolvedValue([
    {
      id: "notif-1",
      userId: "staff-1",
      message: "Link enviado a Ana Silva",
      type: SIGNATURE_LINK_EVENT,
      createdAt: new Date(),
    },
  ]);
  prisma.customer.findUnique.mockResolvedValue(null);
  prisma.notificationOutbox.create.mockResolvedValue({});
  prisma.auditLog.create.mockResolvedValue({});
}

type WsBroadcast = (
  predicate: (c: { role: string; userId: string }) => boolean,
  payload: Record<string, unknown>
) => void;

let prisma: ReturnType<typeof stubPrisma>;
let wsBroadcast: ReturnType<typeof vi.fn<WsBroadcast>>;
let app: Parameters<typeof sendSignatureLink>[0];

beforeEach(() => {
  prisma = stubPrisma();
  wsBroadcast = vi.fn<WsBroadcast>();
  app = { prisma: prisma as never, wsBroadcast };
  wireHappyPath(prisma);
  // accessUrls reads APP_URL — a stray .env value could make the "no
  // remote" test pass for the wrong reason, so pin it off.
  delete process.env.APP_URL;
  resetEnvForTests();
});

describe("sendSignatureLink — session validation", () => {
  it("rejects an unknown token", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(null);
    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an expired session", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });
  });

  it("rejects an already-signed session", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ signatureDataUrl: "data:image/png;base64,xx" })
    );
    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_ALREADY_SUBMITTED" });
  });
});

describe("sendSignatureLink — remote URL resolution", () => {
  it("sends the cloud relay URL for a relayed session", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    const result = await sendSignatureLink(app, TOKEN, "staff-1");

    expect(result.sent).toBe(true);
    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    expect(outbox.data.channel).toBe("WHATSAPP");
    expect(outbox.data.templateName).toBe(SIGNATURE_LINK_EVENT);
    expect(outbox.data.recipientPhone).toBe(PHONE);
    expect(outbox.data.renderedBody).toContain(
      `https://cloud.example.com/sign/${TOKEN}`
    );
  });

  it("falls back to trackingBaseUrl when the session is not relayed", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(intakeSession());
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({ trackingBaseUrl: "https://loja.example.com/" })
    );

    await sendSignatureLink(app, TOKEN, "staff-1");

    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    expect(outbox.data.renderedBody).toContain(
      `https://loja.example.com/sign/${TOKEN}`
    );
  });

  it("refuses when no remotely reachable URL exists", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(intakeSession());
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({ cloudApiUrl: null, trackingBaseUrl: null })
    );

    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_LINK_NO_REMOTE" });
    expect(prisma.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it("refuses when no messaging channel is enabled", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({ whatsappEnabled: false, smsEnabled: false })
    );

    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_LINK_NO_CHANNEL" });
    expect(prisma.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it("SMS Pro sem device na Cloud → recusa em vez de confirmar envio falhado", async () => {
    // Regressão Devin r8: subscrição "sms" sem device enabled na Cloud —
    // o envio caía com DEVICE_MISSING depois do diálogo confirmar.
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({
        cloudEntitlements: ["sms"],
        cloudShopTokenEncrypted: "enc:x",
        cloudSyncedAt: new Date(),
        smsEnabled: false,
        whatsappEnabled: false,
      })
    );
    mocks.getSmsDeviceStatus.mockResolvedValue({
      configured: false,
      device: null,
      entitled: true,
      reachable: true,
      sendable: false,
    });

    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_LINK_NO_CHANNEL" });
    expect(prisma.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it("SMS Pro com device na Cloud → o gate deixa enviar", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({
        cloudEntitlements: ["sms"],
        cloudShopTokenEncrypted: "enc:x",
        cloudSyncedAt: new Date(),
        smsEnabled: false,
        whatsappEnabled: false,
      })
    );
    mocks.getSmsDeviceStatus.mockResolvedValue({
      configured: true,
      device: null,
      entitled: true,
      reachable: true,
      sendable: true,
    });

    await sendSignatureLink(app, TOKEN, "staff-1");
    expect(prisma.notificationOutbox.create).toHaveBeenCalled();
  });
});

describe("sendSignatureLink — staff-initiated consent bypass", () => {
  it("enqueues even with no customer record (intake customer not yet created)", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());
    prisma.customer.findUnique.mockResolvedValue(null);

    await sendSignatureLink(app, TOKEN, "staff-1");

    expect(prisma.notificationOutbox.create).toHaveBeenCalledOnce();
  });

  it("enqueues even when the customer has not opted in", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());
    prisma.customer.findUnique.mockResolvedValue({
      id: "cust-1",
      whatsappConsent: false,
    });

    await sendSignatureLink(app, TOKEN, "staff-1");

    expect(prisma.notificationOutbox.create).toHaveBeenCalledOnce();
  });
});

describe("sendSignatureLink — loaner sessions", () => {
  it("sends the link for a job that still matches its snapshot", async () => {
    const job = loanerJob();
    prisma.signatureSession.findUnique.mockResolvedValue(loanerSession());
    prisma.job.findUnique.mockResolvedValue(job);
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    await sendSignatureLink(app, TOKEN, "staff-1");

    expect(prisma.job.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobCode: "REP-0042" } })
    );
    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    // The snapshot is PT — the doc label follows the document's language,
    // not a fixed English string.
    expect(outbox.data.renderedBody).toContain("o termo de responsabilidade");
    const audit = prisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.jobId).toBe("job-1");
    expect(audit.data.action).toBe("NOTIFICATION_SENT");
    expect(audit.data.note).toBe("signature-link-sent");
    expect(audit.data.metadata.doc).toBe("loaner-agreement");
    // The bearer URL is never recorded — only the masked recipient.
    expect(audit.data.metadata.recipientPhone).toBe("•••5678");
  });

  it("refuses to send a link whose job drifted (SIGNATURE_STALE)", async () => {
    const job = { ...loanerJob(), loanerDevice: null };
    prisma.signatureSession.findUnique.mockResolvedValue(loanerSession());
    prisma.job.findUnique.mockResolvedValue(job);
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_STALE" });
    expect(prisma.notificationOutbox.create).not.toHaveBeenCalled();
  });
});

describe("sendSignatureLink — localized doc labels", () => {
  it.each([
    ["pt", "o termo de responsabilidade"],
    ["en", "the loaner agreement"],
    ["es", "el acuerdo de préstamo"],
    ["fr", "le contrat de prêt"],
  ])("labels a %s loaner agreement as %s", async (locale, label) => {
    const job = loanerJob();
    prisma.signatureSession.findUnique.mockResolvedValue(
      loanerSession({ snapshot: buildLoanerAgreementDocument(job, locale) })
    );
    prisma.job.findUnique.mockResolvedValue(job);
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    await sendSignatureLink(app, TOKEN, "staff-1");

    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    expect(outbox.data.renderedBody).toContain(label);
  });

  it.each([
    ["pt", "a ficha de receção"],
    ["en", "the intake form"],
    ["es", "la ficha de admisión"],
    ["fr", "la fiche d'admission"],
  ])("labels a %s intake form as %s", async (locale, label) => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({
        relayed: true,
        snapshot: {
          v: 1,
          locale,
          customerName: "Ana Silva",
          customerPhone: PHONE,
          problem: "Broken screen",
        },
      })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    await sendSignatureLink(app, TOKEN, "staff-1");

    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    expect(outbox.data.renderedBody).toContain(label);
  });
});

describe("sendSignatureLink — delivery deadline", () => {
  it("stamps the outbox entry with the session expiry", async () => {
    const session = intakeSession({ relayed: true });
    prisma.signatureSession.findUnique.mockResolvedValue(session);
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    await sendSignatureLink(app, TOKEN, "staff-1");

    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    expect(outbox.data.deliverBy).toEqual(session.expiresAt);
  });
});

describe("sendSignatureLink — IPv6 base URLs", () => {
  it("accepts a globally routable IPv6 trackingBaseUrl", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(intakeSession());
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({
        trackingBaseUrl: "https://[2606:4700:4700::1111]:4000/",
      })
    );

    await sendSignatureLink(app, TOKEN, "staff-1");

    const outbox = prisma.notificationOutbox.create.mock.calls[0][0];
    expect(outbox.data.renderedBody).toContain(
      `https://[2606:4700:4700::1111]:4000/sign/${TOKEN}`
    );
  });

  it.each([
    "https://[::1]:4000",
    "https://[::]:4000",
    "https://[fe80::1]:4000",
    "https://[fd00::1]:4000",
    "https://[::ffff:192.168.1.1]:4000",
  ])("refuses the non-public IPv6 base %s", async (url) => {
    prisma.signatureSession.findUnique.mockResolvedValue(intakeSession());
    prisma.shopSettings.findUnique.mockResolvedValue(
      defaultSettings({ cloudApiUrl: null, trackingBaseUrl: url })
    );

    await expect(
      sendSignatureLink(app, TOKEN, "staff-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_LINK_NO_REMOTE" });
    expect(prisma.notificationOutbox.create).not.toHaveBeenCalled();
  });
});

describe("sendSignatureLink — staff confirmation", () => {
  it("records an in-app notification for the staff member who sent it", async () => {
    prisma.signatureSession.findUnique.mockResolvedValue(
      intakeSession({ relayed: true })
    );
    prisma.shopSettings.findUnique.mockResolvedValue(defaultSettings());

    await sendSignatureLink(app, TOKEN, "staff-1");

    const create =
      prisma.inAppNotification.createManyAndReturn.mock.calls[0][0];
    expect(create.data[0].userId).toBe("staff-1");
    expect(create.data[0].type).toBe(SIGNATURE_LINK_EVENT);
    expect(wsBroadcast).toHaveBeenCalled();
  });
});
