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

const { unpublishJobPortal } = await import("../portal.service.js");

const VALID_TOKEN = "a1b2c3d4e5f60718a1b2c3d4e5f60718";

function makePrisma(accessCode: string | null) {
  return {
    job: {
      findUnique: vi.fn(async () => ({ accessCode })),
      update: vi.fn(async () => ({})),
    },
  } as never;
}

const log = { warn: vi.fn() } as never;

describe("unpublishJobPortal — guard do token", () => {
  beforeEach(() => {
    cloudFetchMock.mockReset();
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
    expect(
      (log as never as { warn: ReturnType<typeof vi.fn> }).warn
    ).toHaveBeenCalled();
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
