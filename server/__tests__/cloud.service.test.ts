import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import {
  getCloudStatus,
  pairWithCloud,
  syncCloudEntitlements,
  unpairCloud,
} from "../services/cloud.service.js";

const log = { warn: vi.fn() } as unknown as FastifyBaseLogger;

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
