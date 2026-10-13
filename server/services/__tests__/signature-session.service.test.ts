import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSignatureSession,
  getPublicSignatureSession,
  getSignatureSession,
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

const freshSession = (extra: Record<string, unknown> = {}) => ({
  id: "s-1",
  token: TOKEN,
  signatureDataUrl: null,
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
    const result = await createSignatureSession(prisma);

    expect(result.token).toMatch(TOKEN_HEX_RE);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
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
  it("reports a waiting session as unsigned", async () => {
    const prisma = mockPrisma(freshSession());
    const result = await getPublicSignatureSession(prisma, TOKEN);
    expect(result).toEqual({ signed: false });
  });

  it("reports a signed session without leaking the signature", async () => {
    const prisma = mockPrisma(freshSession({ signatureDataUrl: VALID_PNG }));
    const result = await getPublicSignatureSession(prisma, TOKEN);
    expect(result).toEqual({ signed: true });
    expect(JSON.stringify(result)).not.toContain("base64");
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
  it("stores a valid PNG data URL", async () => {
    const prisma = mockPrisma(freshSession());
    const result = await submitSignatureSession(prisma, TOKEN, VALID_PNG);

    expect(result.ok).toBe(true);
    expect(prisma.signatureSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s-1", signatureDataUrl: null },
      data: { signatureDataUrl: VALID_PNG },
    });
  });

  it("rejects a second submission — single use", async () => {
    const prisma = mockPrisma(freshSession({ signatureDataUrl: VALID_PNG }));
    await expect(
      submitSignatureSession(prisma, TOKEN, VALID_PNG)
    ).rejects.toMatchObject({ code: "SIGNATURE_ALREADY_SUBMITTED" });
    expect(prisma.signatureSession.updateMany).not.toHaveBeenCalled();
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
