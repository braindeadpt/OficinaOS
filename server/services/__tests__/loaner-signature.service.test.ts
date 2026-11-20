import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  buildLoanerAgreementDocument,
  LOANER_AGREEMENT_DOC_KIND,
} from "@shared/loaner-agreement-document.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachLoanerSignature,
  createLoanerSignatureSession,
} from "../loaner-signature.service.js";
import { intakeDocumentHash } from "../signature-session.service.js";

const TOKEN = "b".repeat(64);
const TOKEN_HEX_RE = /^[a-f0-9]{64}$/;
const VALID_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const JOB = {
  id: "job-1",
  jobCode: "R-2026-0001",
  status: "IN_REPAIR",
  hasLoanerDevice: true,
  loanerNote: "Loja #1 (Nokia 105)",
  createdAt: new Date("2026-11-21T10:00:00Z"),
  estimatedDate: new Date("2026-11-24T18:00:00Z"),
  imei: null,
  customer: { name: "Maria Silva", phone: "912345678", taxId: null },
  device: { brand: { name: "Apple" }, model: "iPhone 14" },
  loanerDevice: { label: "Loja #1", brand: "Nokia", model: "105", imei: null },
};

const DOC = buildLoanerAgreementDocument(JOB, "pt");

function mockPrisma(session: Record<string, unknown> | null = null) {
  const tx = {
    job: {
      findUnique: vi.fn().mockResolvedValue(JOB),
      update: vi.fn().mockResolvedValue(JOB),
    },
    signatureSession: {
      findUnique: vi.fn().mockResolvedValue(session),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "s-1", ...data })
        ),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  return tx as unknown as PrismaClient & typeof tx;
}

// No cloud pairing: settings without API URL/token → relay never publishes.
function noRelaySettings(prisma: PrismaClient) {
  (prisma as unknown as Record<string, unknown>).shopSettings = {
    findUnique: vi.fn().mockResolvedValue({
      cloudApiUrl: null,
      cloudShopTokenEncrypted: null,
    }),
  };
  return prisma;
}

const signedSession = (extra: Record<string, unknown> = {}) => ({
  id: "s-1",
  token: TOKEN,
  signatureDataUrl: VALID_PNG,
  snapshot: DOC,
  documentHash: intakeDocumentHash(DOC, VALID_PNG),
  signedAt: new Date("2026-11-21T10:05:00Z"),
  signerIp: "192.168.1.50",
  signerUserAgent: "CustomerPhone/1.0",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  ...extra,
});

const log = { warn: vi.fn(), info: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLoanerSignatureSession", () => {
  it("rejects jobs without a loaner", async () => {
    const prisma = mockPrisma();
    prisma.job.findUnique.mockResolvedValue({ ...JOB, hasLoanerDevice: false });
    await expect(
      createLoanerSignatureSession(prisma, "job-1", "pt", log)
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("rejects cancelled jobs", async () => {
    const prisma = mockPrisma();
    prisma.job.findUnique.mockResolvedValue({ ...JOB, status: "CANCELLED" });
    await expect(
      createLoanerSignatureSession(prisma, "job-1", "pt", log)
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("freezes the canonical agreement — built server-side, never client input", async () => {
    const prisma = noRelaySettings(mockPrisma());
    const result = await createLoanerSignatureSession(
      prisma,
      "job-1",
      "pt",
      log
    );
    expect(result.token).toMatch(TOKEN_HEX_RE);
    const created = vi.mocked(prisma.signatureSession.create).mock
      .calls[0][0] as unknown as {
      data: { snapshot: { doc: string; jobCode: string } };
    };
    expect(created.data.snapshot.doc).toBe(LOANER_AGREEMENT_DOC_KIND);
    expect(created.data.snapshot.jobCode).toBe("R-2026-0001");
    expect(result.cloudSignUrl).toBeNull();
  });
});

describe("attachLoanerSignature", () => {
  it("moves signature, hash and snapshot onto the job", async () => {
    const prisma = mockPrisma(signedSession());
    const result = await attachLoanerSignature(
      prisma,
      "job-1",
      { token: TOKEN },
      "pt",
      "u-1"
    );
    expect(result.ok).toBe(true);
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        loanerAgreementSignatureDataUrl: VALID_PNG,
        loanerAgreementDocumentHash: intakeDocumentHash(DOC, VALID_PNG),
        loanerAgreementSignedVia: "remote",
        loanerAgreementSignerIp: "192.168.1.50",
      }),
    });
    expect(prisma.signatureSession.delete).toHaveBeenCalledWith({
      where: { id: "s-1" },
    });
  });

  it("rejects when the job drifted since the link was made (SIGNATURE_STALE)", async () => {
    const prisma = mockPrisma(signedSession());
    prisma.job.findUnique.mockResolvedValue({
      ...JOB,
      loanerNote: "nota diferente",
    });
    await expect(
      attachLoanerSignature(prisma, "job-1", { token: TOKEN }, "pt", "u-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_STALE" });
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.signatureSession.delete).not.toHaveBeenCalled();
  });

  it("rejects an unsigned session", async () => {
    const prisma = mockPrisma(
      signedSession({ signatureDataUrl: null, signedAt: null })
    );
    await expect(
      attachLoanerSignature(prisma, "job-1", { token: TOKEN }, "pt", "u-1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an intake session — wrong document kind", async () => {
    const prisma = mockPrisma(signedSession({ snapshot: { v: 2 } }));
    await expect(
      attachLoanerSignature(prisma, "job-1", { token: TOKEN }, "pt", "u-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_STALE" });
  });

  it("410s on expired or unknown sessions", async () => {
    const expired = mockPrisma(
      signedSession({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(
      attachLoanerSignature(expired, "job-1", { token: TOKEN }, "pt", "u-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });

    const missing = mockPrisma(null);
    await expect(
      attachLoanerSignature(missing, "job-1", { token: TOKEN }, "pt", "u-1")
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });
  });

  it("rejects malformed tokens without hitting the database", async () => {
    const prisma = mockPrisma();
    await expect(
      attachLoanerSignature(
        prisma,
        "job-1",
        { token: "not-a-token" },
        "pt",
        "u-1"
      )
    ).rejects.toBeInstanceOf(AppError);
  });

  it("attaches an in-person signature — doc rebuilt from the job, via in_person", async () => {
    const prisma = mockPrisma();
    const result = await attachLoanerSignature(
      prisma,
      "job-1",
      { signatureDataUrl: VALID_PNG },
      "pt",
      "u-1"
    );
    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.job.update).mock.calls[0][0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(call.data.loanerAgreementSignatureDataUrl).toBe(VALID_PNG);
    expect(call.data.loanerAgreementDocumentHash).toBe(
      intakeDocumentHash(DOC, VALID_PNG)
    );
    expect(call.data.loanerAgreementSignedVia).toBe("in_person");
    expect(call.data.loanerAgreementSignerIp).toBeNull();
    expect(call.data.loanerAgreementSignerUserAgent).toBeNull();
    expect(call.data.loanerAgreementSnapshot).toEqual(DOC);
    expect(prisma.signatureSession.findUnique).not.toHaveBeenCalled();
  });

  it("in-person attach still rejects jobs without an active loaner", async () => {
    const prisma = mockPrisma();
    prisma.job.findUnique.mockResolvedValue({ ...JOB, hasLoanerDevice: false });
    await expect(
      attachLoanerSignature(
        prisma,
        "job-1",
        { signatureDataUrl: VALID_PNG },
        "pt",
        "u-1"
      )
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("requires exactly one of token or signatureDataUrl", async () => {
    const prisma = mockPrisma();
    await expect(
      attachLoanerSignature(prisma, "job-1", {}, "pt", "u-1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      attachLoanerSignature(
        prisma,
        "job-1",
        { signatureDataUrl: VALID_PNG, token: TOKEN },
        "pt",
        "u-1"
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });

  it("rejects malformed or oversized in-person signatures before the tx", async () => {
    const prisma = mockPrisma();
    await expect(
      attachLoanerSignature(
        prisma,
        "job-1",
        { signatureDataUrl: "data:image/svg+xml,<svg/>" },
        "pt",
        "u-1"
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      attachLoanerSignature(
        prisma,
        "job-1",
        { signatureDataUrl: `data:image/png;base64,${"A".repeat(700 * 1024)}` },
        "pt",
        "u-1"
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });
});
