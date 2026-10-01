import { Prisma } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import {
  getCloudStatus,
  pairWithCloud,
  pullCloudIntake,
  syncCloudEntitlements,
  unpairCloud,
} from "../services/cloud.service.js";

const log = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as FastifyBaseLogger;

interface ShopRow {
  cloudApiUrl: string | null;
  cloudEntitlements: unknown;
  cloudShopId: string | null;
  cloudShopName: string | null;
  cloudShopTokenEncrypted: string | null;
  cloudSyncedAt: Date | null;
  id: string;
  shopName: string;
}

function fakePrisma(initial: Partial<ShopRow> = {}) {
  const row: ShopRow = {
    id: "default",
    shopName: "Loja Teste",
    cloudApiUrl: null,
    cloudShopTokenEncrypted: null,
    cloudShopId: null,
    cloudShopName: null,
    cloudEntitlements: null,
    cloudSyncedAt: null,
    ...initial,
  };
  const prisma = {
    shopSettings: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(({ data }: { data: Partial<ShopRow> }) => {
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      }),
    },
  };
  return { prisma, row };
}

function okJson(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pairWithCloud", () => {
  it("redeems a code, stores the token encrypted and syncs entitlements", async () => {
    const { prisma, row } = fakePrisma();
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url.endsWith("/pairing/redeem")) {
        return okJson({
          shopToken: "tok-secret",
          shopId: "shop-1",
          shopName: "Loja Cloud",
        });
      }
      return okJson({ modules: ["ai-reports"], shopName: "Loja Cloud" });
    });

    const status = await pairWithCloud(
      prisma as never,
      { apiUrl: "https://cloud.example.com/", code: "ABCD-1234" },
      log
    );

    expect(status.paired).toBe(true);
    expect(status.shopName).toBe("Loja Cloud");
    expect(status.modules).toEqual(["ai-reports"]);
    // Token must be stored encrypted, never plaintext
    expect(row.cloudShopTokenEncrypted).not.toBe("tok-secret");
    expect(isEncrypted(row.cloudShopTokenEncrypted ?? "")).toBe(true);
    expect(decryptSecret(row.cloudShopTokenEncrypted ?? "")).toBe("tok-secret");
    // Trailing slash on the API URL must not produce "//path"
    expect(calls[0]).toBe("https://cloud.example.com/pairing/redeem");
  });

  it("maps a 400 from the cloud to CLOUD_INVALID_CODE", async () => {
    const { prisma } = fakePrisma();
    vi.stubGlobal("fetch", () =>
      okJson({ error: { code: "INVALID_OR_EXPIRED_CODE" } }, 400)
    );

    await expect(
      pairWithCloud(
        prisma as never,
        { apiUrl: "https://cloud.example.com", code: "BAD" },
        log
      )
    ).rejects.toMatchObject({ code: "CLOUD_INVALID_CODE" });
  });

  it("throws CLOUD_UNREACHABLE when the server cannot be contacted", async () => {
    const { prisma } = fakePrisma();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));

    await expect(
      pairWithCloud(
        prisma as never,
        { apiUrl: "https://cloud.example.com", code: "ABCD" },
        log
      )
    ).rejects.toMatchObject({ code: "CLOUD_UNREACHABLE" });
  });
});

describe("syncCloudEntitlements", () => {
  it("fails fast when not paired", async () => {
    const { prisma } = fakePrisma();
    await expect(
      syncCloudEntitlements(prisma as never, log)
    ).rejects.toMatchObject({ code: "CLOUD_NOT_PAIRED" });
  });

  it("sends the decrypted bearer token and caches modules", async () => {
    const { encryptSecret } = await import("../lib/crypto.js");
    const { prisma, row } = fakePrisma({
      cloudApiUrl: "https://cloud.example.com",
      cloudShopTokenEncrypted: encryptSecret("tok-abc"),
    });
    let auth = "";
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      auth = String(
        (init?.headers as Record<string, string>)?.authorization ?? ""
      );
      return okJson({ modules: ["ai-reports", "diag"], shopName: "Loja" });
    });

    const status = await syncCloudEntitlements(prisma as never, log);
    expect(auth).toBe("Bearer tok-abc");
    expect(status.reachable).toBe(true);
    expect(row.cloudEntitlements).toEqual(["ai-reports", "diag"]);
    expect(row.cloudSyncedAt).toBeInstanceOf(Date);
  });

  it("serves cached entitlements when the cloud is down", async () => {
    const { encryptSecret } = await import("../lib/crypto.js");
    const { prisma } = fakePrisma({
      cloudApiUrl: "https://cloud.example.com",
      cloudShopTokenEncrypted: encryptSecret("tok-abc"),
      cloudEntitlements: ["ai-reports"],
      cloudSyncedAt: new Date(),
    });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));

    const status = await syncCloudEntitlements(prisma as never, log);
    expect(status.reachable).toBe(false);
    expect(status.modules).toEqual(["ai-reports"]);
  });
});

describe("getCloudStatus", () => {
  it("returns unpaired status without calling the cloud", async () => {
    const { prisma } = fakePrisma();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const status = await getCloudStatus(prisma as never, log);
    expect(status.paired).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("unpairCloud", () => {
  it("clears all cloud fields", async () => {
    const { prisma, row } = fakePrisma({
      cloudApiUrl: "https://x",
      cloudShopTokenEncrypted: "v1:a:b:c",
      cloudShopId: "s1",
      cloudShopName: "Loja",
      cloudEntitlements: ["m"],
      cloudSyncedAt: new Date(),
    });
    await unpairCloud(prisma as never);
    expect(row.cloudShopTokenEncrypted).toBeNull();
    expect(row.cloudApiUrl).toBeNull();
    expect(row.cloudShopId).toBeNull();
  });
});

describe("pullCloudIntake", () => {
  function intakePrisma(created: unknown[] = []) {
    return {
      $queryRaw: vi.fn(async () => [{ lastSeq: 7 }]),
      intakeRequest: {
        create: vi.fn((args: { data: unknown }) => {
          created.push(args.data);
          return Promise.resolve({ id: "ir1", ...(args.data as object) });
        }),
      },
      user: { findMany: vi.fn(async () => []) },
    };
  }

  it("imports pending reports as IntakeRequests and acks them", async () => {
    const created: {
      customerName: string;
      deviceLabel: string;
      externalId: string;
    }[] = [];
    const prisma = intakePrisma(created);
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      if (url.endsWith("/shops/intake")) {
        return okJson({
          reports: [
            {
              id: "r1",
              createdAt: "2026-10-01T00:00:00Z",
              payload: {
                customerName: "Maria",
                customerPhone: "912345678",
                device: { brand: "Samsung", model: "S21" },
                results: { battery: { cycleCount: 410 } },
              },
            },
          ],
        });
      }
      return okJson({ ok: true });
    });

    await pullCloudIntake(
      prisma as never,
      "tok",
      "https://cloud",
      log as never
    );

    expect(prisma.intakeRequest.create).toHaveBeenCalledOnce();
    expect(created[0]?.externalId).toBe("r1");
    expect(created[0]?.customerName).toBe("Maria");
    expect(created[0]?.deviceLabel).toBe("Samsung S21");
    expect(urls.some((u) => u.endsWith("/shops/intake/ack"))).toBe(true);
  });

  it("acks already-imported reports instead of duplicating them", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{ lastSeq: 8 }]),
      intakeRequest: {
        create: vi.fn(() =>
          Promise.reject(
            new Prisma.PrismaClientKnownRequestError("dup", {
              clientVersion: "7",
              code: "P2002",
            })
          )
        ),
      },
      user: { findMany: vi.fn(async () => []) },
    };
    const bodies: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: { body?: string }) => {
      if (url.endsWith("/shops/intake")) {
        return okJson({
          reports: [
            {
              id: "r-dup",
              payload: { customerName: "A", customerPhone: "1" },
            },
          ],
        });
      }
      if (init?.body) {
        bodies.push(init.body);
      }
      return okJson({ ok: true });
    });

    await pullCloudIntake(
      prisma as never,
      "tok",
      "https://cloud",
      log as never
    );
    expect(bodies.some((b) => b.includes("r-dup"))).toBe(true);
  });
});
