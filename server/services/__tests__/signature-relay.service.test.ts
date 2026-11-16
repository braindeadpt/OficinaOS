import { createHash } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import {
  buildIntakeDocument,
  type IntakeDocumentSource,
} from "@shared/intake-document.js";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../../lib/crypto.js";
import {
  pairingSignatureCreds,
  publishSignatureRelay,
  pullSignatureReplies,
  REMOTE_SESSION_TTL_MS,
  remoteSignatureCreds,
} from "../signature-relay.service.js";

const log = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as FastifyBaseLogger;

const TOKEN = "a".repeat(64);
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const API = "https://cloud.oficinaos.app";

const SOURCE: IntakeDocumentSource = {
  accessories: ["charger", "case"],
  customerName: "Maria Silva",
  customerPhone: "912345678",
  deviceBrand: "Apple",
  deviceModel: "iPhone 12",
  reportedProblem: "Ecrã partido",
  repairs: [{ repairName: "Screen replacement", price: 99.9 }],
};

interface SessionRow {
  expiresAt: Date;
  id: string;
  signatureDataUrl: string | null;
  signedAt: Date | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  snapshot: unknown;
  token: string;
}

function fakePrisma(
  settings: {
    cloudApiUrl?: string | null;
    cloudEntitlements?: unknown;
    cloudShopTokenEncrypted?: string | null;
    cloudSyncedAt?: Date | null;
  } = {},
  sessions: SessionRow[] = []
) {
  const prisma = {
    shopSettings: {
      findUnique: vi.fn(async () => ({
        id: "default",
        shopName: "Loja Teste",
        cloudApiUrl: settings.cloudApiUrl ?? null,
        cloudEntitlements: settings.cloudEntitlements ?? null,
        cloudShopId: null,
        cloudShopName: null,
        cloudShopTokenEncrypted: settings.cloudShopTokenEncrypted ?? null,
        cloudSyncedAt: settings.cloudSyncedAt ?? null,
      })),
      update: vi.fn(async () => ({})),
    },
    signatureSession: {
      findUnique: vi.fn(
        async ({ where }: { where: { token: string } }) =>
          sessions.find((s) => s.token === where.token) ?? null
      ),
      findMany: vi.fn(async () => sessions.map((s) => ({ token: s.token }))),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; signatureDataUrl: null };
          data: Partial<SessionRow>;
        }) => {
          let count = 0;
          for (const s of sessions) {
            if (s.id === where.id && s.signatureDataUrl === null) {
              Object.assign(s, data);
              count++;
            }
          }
          return Promise.resolve({ count });
        }
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, sessions };
}

function okJson(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

const entitled = () => ({
  cloudApiUrl: API,
  cloudEntitlements: ["signature-remote"],
  cloudShopTokenEncrypted: encryptSecret("tok-cloud"),
  cloudSyncedAt: new Date(),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("remoteSignatureCreds", () => {
  it("is null when the shop is not paired", async () => {
    const { prisma } = fakePrisma();
    expect(await remoteSignatureCreds(prisma)).toBeNull();
  });

  it("is null without the module even when paired", async () => {
    const { prisma } = fakePrisma({
      cloudApiUrl: API,
      cloudEntitlements: ["portal"],
      cloudShopTokenEncrypted: encryptSecret("tok"),
      cloudSyncedAt: new Date(),
    });
    expect(await remoteSignatureCreds(prisma)).toBeNull();
  });

  it("is null when the entitlement hint is older than 24h", async () => {
    const { prisma } = fakePrisma({
      cloudApiUrl: API,
      cloudEntitlements: ["signature-remote"],
      cloudShopTokenEncrypted: encryptSecret("tok"),
      cloudSyncedAt: new Date(Date.now() - 25 * 3600 * 1000),
    });
    expect(await remoteSignatureCreds(prisma)).toBeNull();
  });

  it("returns cloud credentials when entitled", async () => {
    const { prisma } = fakePrisma(entitled());
    const creds = await remoteSignatureCreds(prisma);
    expect(creds?.apiUrl).toBe(API);
    expect(creds?.token).toBe("tok-cloud");
  });
});

describe("pairingSignatureCreds", () => {
  it("is null when the shop is not paired", async () => {
    const { prisma } = fakePrisma();
    expect(await pairingSignatureCreds(prisma)).toBeNull();
  });

  it("returns credentials WITHOUT the module — cleanup must outlive entitlement", async () => {
    // A revoked/lapsed module can never block invalidate → the cloud copy
    // would keep serving the customer document until its own expiry.
    const { prisma } = fakePrisma({
      cloudApiUrl: API,
      cloudEntitlements: ["portal"],
      cloudShopTokenEncrypted: encryptSecret("tok"),
      cloudSyncedAt: new Date(),
    });
    const creds = await pairingSignatureCreds(prisma);
    expect(creds?.apiUrl).toBe(API);
    expect(creds?.token).toBe("tok");
  });
});

describe("publishSignatureRelay", () => {
  const doc = buildIntakeDocument(SOURCE, "termos", "pt");

  it("returns the public cloud URL and sends only the redacted document", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return okJson({ ok: true });
    });
    const url = await publishSignatureRelay(
      { apiUrl: API, token: "t" },
      {
        token: TOKEN,
        document: doc,
        expiresAt: new Date(Date.now() + REMOTE_SESSION_TTL_MS),
      },
      log
    );
    expect(url).toBe(`${API}/sign/${TOKEN}`);
    const body = sent as {
      document?: Record<string, unknown>;
      token?: string;
      tokenHash?: string;
    };
    // The cloud stores only the hash — the raw credential never leaves.
    expect(body.tokenHash).toBe(
      createHash("sha256").update(TOKEN).digest("hex")
    );
    expect(body.token).toBeUndefined();
    expect(body.document?.customerName).toBe("Maria Silva");
    // The redacted view never carries the phone — the LAN doc has it.
    expect(body.document?.customerPhone).toBeUndefined();
  });

  it("returns null when the cloud declines or is unreachable", async () => {
    vi.stubGlobal("fetch", () => okJson({ error: "MODULE_NOT_ENTITLED" }, 402));
    expect(
      await publishSignatureRelay(
        { apiUrl: API, token: "t" },
        { token: TOKEN, document: doc, expiresAt: new Date() },
        log
      )
    ).toBeNull();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));
    expect(
      await publishSignatureRelay(
        { apiUrl: API, token: "t" },
        { token: TOKEN, document: doc, expiresAt: new Date() },
        log
      )
    ).toBeNull();
  });
});

describe("pullSignatureReplies", () => {
  function session(token: string): SessionRow {
    return {
      id: `s-${token.slice(0, 4)}`,
      token,
      snapshot: null,
      signatureDataUrl: null,
      signedAt: null,
      signerIp: null,
      signerUserAgent: null,
      expiresAt: new Date(Date.now() + REMOTE_SESSION_TTL_MS),
    };
  }

  it("writes the signature onto the local session and acks it", async () => {
    const { prisma, sessions } = fakePrisma(entitled(), [session(TOKEN)]);
    const posts: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      posts.push(url);
      if (url.endsWith("/signature/replies")) {
        return okJson({
          replies: [
            {
              tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
              signatureDataUrl: PNG,
              signedAt: new Date().toISOString(),
              signerIp: "203.0.113.9",
              signerUserAgent: "Mozilla/5.0",
            },
          ],
        });
      }
      return okJson({ ok: true });
    });
    await pullSignatureReplies(prisma, API, "tok", log);
    const s = sessions[0];
    expect(s.signatureDataUrl).toBe(PNG);
    expect(s.signerIp).toBe("203.0.113.9");
    expect(s.signerUserAgent).toBe("Mozilla/5.0");
    expect(posts.some((u) => u.endsWith("/signature/replies/ack"))).toBe(true);
  });

  it("stores the customer's signedAt, not the pull time", async () => {
    // Customer signed 12 minutes ago while the shop was offline — the job
    // must show HER moment, not when the poller happened to run.
    const signedAt = new Date(Date.now() - 12 * 60 * 1000);
    const { prisma, sessions } = fakePrisma(entitled(), [session(TOKEN)]);
    vi.stubGlobal("fetch", (url: string) =>
      url.endsWith("/signature/replies")
        ? okJson({
            replies: [
              {
                tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
                signatureDataUrl: PNG,
                signedAt: signedAt.toISOString(),
              },
            ],
          })
        : okJson({ ok: true })
    );
    await pullSignatureReplies(prisma, API, "tok", log);
    expect(sessions[0].signedAt?.getTime()).toBe(signedAt.getTime());
  });

  it("falls back to pull time when signedAt is bogus or future", async () => {
    const before = Date.now();
    for (const bad of [
      "not-a-date",
      new Date(Date.now() + 3_600_000).toISOString(),
    ]) {
      const { prisma, sessions } = fakePrisma(entitled(), [session(TOKEN)]);
      vi.stubGlobal("fetch", (url: string) =>
        url.endsWith("/signature/replies")
          ? okJson({
              replies: [
                {
                  tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
                  signatureDataUrl: PNG,
                  signedAt: bad,
                },
              ],
            })
          : okJson({ ok: true })
      );
      await pullSignatureReplies(prisma, API, "tok", log);
      expect(sessions[0].signedAt?.getTime()).toBeGreaterThanOrEqual(before);
      vi.unstubAllGlobals();
    }
  });

  it("acks replies whose local session is already gone", async () => {
    const { prisma } = fakePrisma(entitled(), []); // no local session
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url.endsWith("/signature/replies")) {
        return okJson({
          replies: [
            {
              tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
              signatureDataUrl: PNG,
            },
          ],
        });
      }
      return okJson({ ok: true });
    });
    await pullSignatureReplies(prisma, API, "tok", log);
    expect(calls.some((u) => u.endsWith("/signature/replies/ack"))).toBe(true);
  });

  it("does nothing when the cloud fetch fails", async () => {
    const { prisma } = fakePrisma(entitled(), [session(TOKEN)]);
    vi.stubGlobal("fetch", () => okJson({ error: "x" }, 500));
    await pullSignatureReplies(prisma, API, "tok", log);
    expect(log.warn).toHaveBeenCalled();
  });
});
