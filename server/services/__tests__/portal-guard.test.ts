import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudFetchMock = vi.fn();
vi.mock("../cloud.service.js", () => ({ cloudFetch: cloudFetchMock }));
vi.mock("../../lib/crypto.js", () => ({ decryptSecret: () => "shop-token" }));
vi.mock("../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: async () => ({
    cloudApiUrl: "https://cloud.example.com",
    cloudShopTokenEncrypted: "enc",
  }),
}));
vi.mock("../job.service.js", () => ({
  lookupByCodeAuth: vi.fn(async () => null),
}));

const { syncPortal, unpublishJobPortal } = await import("../portal.service.js");

const VALID_TOKEN = "a1b2c3d4e5f60718a1b2c3d4e5f60718";
const VALID_HASH =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

function makePrisma(accessCode: string | null) {
  return {
    job: {
      findUnique: vi.fn(async () => ({ accessCode })),
      update: vi.fn(async () => ({})),
    },
  } as never;
}

const warnMock = vi.fn();
const log = { info: vi.fn(), warn: warnMock } as never;

describe("unpublishJobPortal — guard do token", () => {
  beforeEach(() => {
    cloudFetchMock.mockReset();
    warnMock.mockReset();
    cloudFetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  it("valid accessCode issues the DELETE to the cloud", async () => {
    const prisma = makePrisma(VALID_TOKEN);
    await unpublishJobPortal(prisma, "job-1", log);
    expect(cloudFetchMock).toHaveBeenCalledWith(
      "https://cloud.example.com",
      `/portal/pages/${VALID_TOKEN}`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it.each([
    ["null", null],
    ["undefined-inexistente", undefined],
    ["curto demais", "ab12"],
    ["não-hex", "zzb2c3d4e5f60718"],
    ["o literal undefined", "undefined"],
  ])("accessCode %s never reaches the cloud — local warning instead", async (_label, accessCode) => {
    const prisma = makePrisma(accessCode as string | null);
    await unpublishJobPortal(prisma, "job-1", log);
    expect(cloudFetchMock).not.toHaveBeenCalled();
    // O aviso é emitido neste caso concreto — o mock é reiniciado entre
    // casos, logo um aviso anterior nunca valida o caso seguinte.
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("still clears portalPublishedAt locally when the token is invalid", async () => {
    const prisma = makePrisma(null);
    await unpublishJobPortal(prisma, "job-1", log);
    const update = (
      prisma as never as { job: { update: ReturnType<typeof vi.fn> } }
    ).job.update;
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { portalPublishedAt: null } })
    );
  });
});

describe("syncPortal — limpeza de páginas órfãs por hash", () => {
  beforeEach(() => {
    cloudFetchMock.mockReset();
    warnMock.mockReset();
  });

  function orphanSetup() {
    const prisma = {
      job: {
        // Nada publicado localmente — todas as páginas da cloud são órfãs.
        findMany: vi.fn(async () => []),
      },
    } as never;
    cloudFetchMock.mockImplementation((_apiUrl: string, path: string) => {
      if (path === "/shops/portal-pages") {
        return Promise.resolve({
          ok: true,
          body: {
            pages: [
              {
                jobCode: "REP-1",
                tokenHash: VALID_HASH,
                updatedAt: "2026-01-01T00:00:00Z",
              },
              {
                jobCode: "REP-2",
                tokenHash: "nao-e-hex",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
        });
      }
      if (path === "/portal/replies") {
        return Promise.resolve({ ok: true, body: { replies: [] } });
      }
      return Promise.resolve({ ok: true, body: {} });
    });
    return prisma;
  }

  it("deletes orphans with a valid hash and skips invalid ones", async () => {
    const prisma = orphanSetup();
    await syncPortal(prisma, "https://cloud.example.com", "shop-token", log);
    const deletes = cloudFetchMock.mock.calls.filter(
      (c) => (c[2] as { method?: string }).method === "DELETE"
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.[1]).toBe(`/portal/pages/by-hash/${VALID_HASH}`);
    // O hash inválido produziu aviso em vez de pedido.
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
