import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  buildIntakeDocument,
  type IntakeDocumentSource,
  publicDocumentView,
} from "@shared/intake-document.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeSignatureSession,
  createSignatureSession,
  documentMatches,
  getPublicSignatureSession,
  getSignatureSession,
  intakeDocumentHash,
  invalidateSignatureSession,
  submitSignatureSession,
} from "../signature-session.service";

function mockPrisma(
  session: Record<string, unknown> | null = null,
  overrides: Record<string, unknown> = {}
) {
  const mock = {
    signatureSession: {
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "s-1", ...data })
        ),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(session),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides,
    },
  };
  return mock as unknown as PrismaClient;
}

const TOKEN = "a".repeat(64);
const TOKEN_HEX_RE = /^[a-f0-9]{64}$/;
const VALID_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SOURCE: IntakeDocumentSource = {
  accessories: ["charger", "case"],
  customerName: "Maria Silva",
  customerPhone: "912345678",
  deviceBrand: "Apple",
  deviceModel: "iPhone 14",
  reportedProblem: "Screen cracked after a fall.",
  repairs: [{ repairName: "Screen replacement", price: 99.9 }],
};

const DOC = buildIntakeDocument(SOURCE, "Termos de entrada", "pt");

const freshSession = (extra: Record<string, unknown> = {}) => ({
  id: "s-1",
  token: TOKEN,
  signatureDataUrl: null,
  snapshot: null,
  documentHash: null,
  signedAt: null,
  signerIp: null,
  signerUserAgent: null,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSignatureSession", () => {
  it("creates a session with a 64-hex token and a future expiry", async () => {
    const prisma = mockPrisma();
    const result = await createSignatureSession(prisma, DOC);

    expect(result.token).toMatch(TOKEN_HEX_RE);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(prisma.signatureSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ snapshot: DOC }),
      })
    );
  });
});

describe("getSignatureSession (staff poll)", () => {
  it("returns the signature when the customer has signed", async () => {
    const prisma = mockPrisma(freshSession({ signatureDataUrl: VALID_PNG }));
    const result = await getSignatureSession(prisma, TOKEN);

    expect(result.signed).toBe(true);
    expect(result.signatureDataUrl).toBe(VALID_PNG);
  });

  it("returns unsigned state for a waiting session", async () => {
    const prisma = mockPrisma(freshSession());
    const result = await getSignatureSession(prisma, TOKEN);

    expect(result.signed).toBe(false);
    expect(result.signatureDataUrl).toBeNull();
  });

  it("404s on malformed tokens without hitting the database", async () => {
    const prisma = mockPrisma();
    await expect(getSignatureSession(prisma, "short")).rejects.toThrowError(
      AppError
    );
    await expect(getSignatureSession(prisma, "short")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(prisma.signatureSession.findUnique).not.toHaveBeenCalled();
  });

  it("404s on unknown tokens", async () => {
    const prisma = mockPrisma(null);
    await expect(getSignatureSession(prisma, TOKEN)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("getPublicSignatureSession", () => {
  it("reports a waiting session as unsigned with its document", async () => {
    const prisma = mockPrisma(freshSession({ snapshot: DOC }));
    const result = await getPublicSignatureSession(prisma, TOKEN);
    expect(result.signed).toBe(false);
    expect(result.document?.customerName).toBe("Maria Silva");
  });

  it("reports a signed session without leaking the signature", async () => {
    const prisma = mockPrisma(freshSession({ signatureDataUrl: VALID_PNG }));
    const result = await getPublicSignatureSession(prisma, TOKEN);
    expect(result.signed).toBe(true);
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  it("redacts contact and identifier fields from the public document", async () => {
    const prisma = mockPrisma(freshSession({ snapshot: DOC }));
    const result = await getPublicSignatureSession(prisma, TOKEN);
    const doc = JSON.stringify(result.document);
    expect(doc).not.toContain("912345678");
    expect(doc).not.toContain("imei");
    expect(doc).not.toContain("customerPhone");
  });

  it("410s on expired sessions", async () => {
    const prisma = mockPrisma(
      freshSession({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(
      getPublicSignatureSession(prisma, TOKEN)
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });
  });

  it("410s on unknown sessions — same as expired, nothing leaks", async () => {
    const prisma = mockPrisma(null);
    await expect(
      getPublicSignatureSession(prisma, TOKEN)
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });
  });
});

describe("submitSignatureSession", () => {
  it("stores a valid PNG data URL with hash and provenance", async () => {
    const prisma = mockPrisma(freshSession({ snapshot: DOC }));
    const result = await submitSignatureSession(prisma, TOKEN, VALID_PNG, {
      ip: "203.0.113.9",
      userAgent: "TestBrowser/1.0",
    });

    expect(result.ok).toBe(true);
    expect(prisma.signatureSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-1", signatureDataUrl: null },
      data: {
        signatureDataUrl: VALID_PNG,
        documentHash: intakeDocumentHash(DOC, VALID_PNG),
        signedAt: expect.any(Date),
        signerIp: "203.0.113.9",
        signerUserAgent: "TestBrowser/1.0",
      },
    });
  });

  it("rejects a second submission — single use", async () => {
    const prisma = mockPrisma(freshSession({ signatureDataUrl: VALID_PNG }));
    await expect(
      submitSignatureSession(prisma, TOKEN, VALID_PNG)
    ).rejects.toMatchObject({ code: "SIGNATURE_ALREADY_SUBMITTED" });
    expect(prisma.signatureSession.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a racing second submission — atomic claim returns 0", async () => {
    const prisma = mockPrisma(freshSession(), {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(
      submitSignatureSession(prisma, TOKEN, VALID_PNG)
    ).rejects.toMatchObject({ code: "SIGNATURE_ALREADY_SUBMITTED" });
  });

  it("410s on expired sessions", async () => {
    const prisma = mockPrisma(
      freshSession({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(
      submitSignatureSession(prisma, TOKEN, VALID_PNG)
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });
  });

  it("400s on non-PNG or malformed payloads", async () => {
    const prisma = mockPrisma(freshSession());
    await expect(
      submitSignatureSession(prisma, TOKEN, "not-a-data-url")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      submitSignatureSession(prisma, TOKEN, "data:text/html;base64,PGI+")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.signatureSession.updateMany).not.toHaveBeenCalled();
  });

  it("400s on oversized payloads", async () => {
    const prisma = mockPrisma(freshSession());
    const huge = `data:image/png;base64,${"A".repeat(600 * 1024)}`;
    await expect(
      submitSignatureSession(prisma, TOKEN, huge)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("404s on malformed tokens without hitting the database", async () => {
    const prisma = mockPrisma();
    await expect(
      submitSignatureSession(prisma, "bad", VALID_PNG)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.signatureSession.findUnique).not.toHaveBeenCalled();
  });
});

describe("consumeSignatureSession (job intake)", () => {
  const signedSession = (extra: Record<string, unknown> = {}) =>
    freshSession({
      signatureDataUrl: VALID_PNG,
      snapshot: DOC,
      documentHash: intakeDocumentHash(DOC, VALID_PNG),
      signedAt: new Date(),
      signerIp: "203.0.113.9",
      signerUserAgent: "TestBrowser/1.0",
      ...extra,
    });

  it("returns the signature + provenance when the ficha still matches", async () => {
    const prisma = mockPrisma(signedSession());
    const session = await consumeSignatureSession(prisma, TOKEN, SOURCE);

    expect(session.signatureDataUrl).toBe(VALID_PNG);
    expect(session.documentHash).toBe(intakeDocumentHash(DOC, VALID_PNG));
    expect(prisma.signatureSession.delete).toHaveBeenCalledWith({
      where: { id: "s-1" },
    });
  });

  it("rejects a ficha that drifted after the link was created", async () => {
    const prisma = mockPrisma(signedSession());
    await expect(
      consumeSignatureSession(prisma, TOKEN, {
        ...SOURCE,
        reportedProblem: "Different problem entirely",
      })
    ).rejects.toMatchObject({ code: "SIGNATURE_STALE" });
    expect(prisma.signatureSession.delete).not.toHaveBeenCalled();
  });

  it("keeps the frozen terms — they can't be rewritten at submit", async () => {
    // termsText lives only in the snapshot: later edits to the shop's terms
    // cannot change what was signed, and input has no terms field to inject.
    const drifted = { ...DOC, termsText: "Termos diferentes" };
    const prisma = mockPrisma(signedSession({ snapshot: drifted }));
    const session = await consumeSignatureSession(prisma, TOKEN, SOURCE);
    expect((session.snapshot as unknown as typeof DOC).termsText).toBe(
      "Termos diferentes"
    );
  });

  it("400s on an unsigned session", async () => {
    const prisma = mockPrisma(freshSession({ snapshot: DOC }));
    await expect(
      consumeSignatureSession(prisma, TOKEN, SOURCE)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("410s on expired sessions", async () => {
    const prisma = mockPrisma(
      signedSession({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(
      consumeSignatureSession(prisma, TOKEN, SOURCE)
    ).rejects.toMatchObject({ code: "SIGNATURE_SESSION_EXPIRED" });
  });
});

describe("invalidateSignatureSession", () => {
  it("deletes the session row", async () => {
    const prisma = mockPrisma();
    await invalidateSignatureSession(prisma, TOKEN);
    expect(prisma.signatureSession.deleteMany).toHaveBeenCalledWith({
      where: { token: TOKEN },
    });
  });
});

describe("unlock code privacy", () => {
  it("never stores the device PIN in the signed document", async () => {
    const withPin = buildIntakeDocument(
      { ...SOURCE, deviceUnlockCode: "864209" },
      "Termos de entrada",
      "pt"
    );
    expect(withPin.unlockCodeProvided).toBe(true);
    expect(JSON.stringify(withPin)).not.toContain("864209");

    // …and the snapshot persisted on the session carries no PIN either.
    const prisma = mockPrisma();
    await createSignatureSession(prisma, withPin);
    const created = vi.mocked(prisma.signatureSession.create).mock
      .calls[0][0] as { data: { snapshot: unknown } };
    expect(JSON.stringify(created.data.snapshot)).not.toContain("864209");
  });
});

describe("document hashing", () => {
  it("is deterministic regardless of key order", () => {
    const reordered = Object.fromEntries(
      Object.entries(DOC).reverse()
    ) as typeof DOC;
    expect(intakeDocumentHash(reordered, VALID_PNG)).toBe(
      intakeDocumentHash(DOC, VALID_PNG)
    );
  });

  it("changes when any document field changes", () => {
    const changed = { ...DOC, estimatedCost: 150 };
    expect(intakeDocumentHash(changed, VALID_PNG)).not.toBe(
      intakeDocumentHash(DOC, VALID_PNG)
    );
  });

  it("changes when the signature image changes", () => {
    const other = `${VALID_PNG.slice(0, -4)}BBBB`;
    expect(intakeDocumentHash(DOC, other)).not.toBe(
      intakeDocumentHash(DOC, VALID_PNG)
    );
  });

  it("documentMatches rebuilds the same canonical form from the payload", () => {
    expect(documentMatches(DOC, SOURCE)).toBe(true);
    expect(documentMatches(DOC, { ...SOURCE, isUrgent: true })).toBe(false);
    expect(documentMatches(null, SOURCE)).toBe(false);
  });
});

describe("publicDocumentView", () => {
  it("never includes phone, email, IMEI or unlock code", () => {
    const view = publicDocumentView({
      ...DOC,
      customerEmail: "maria@example.com",
      imei: "356789104567890",
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("maria@example.com");
    expect(serialized).not.toContain("356789104567890");
    expect(serialized).not.toContain("unlock");
    expect(serialized).not.toContain("customerPhone");
    expect(view.termsText).toBe("Termos de entrada");
  });
});
