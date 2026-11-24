import { beforeEach, describe, expect, it, vi } from "vitest";

// Purga RGPD das fotos de prova do ponto: linhas PontoPhoto com mais de
// 90 dias são apagadas (linha + ficheiro); o TimeEntry fica com a
// referência órfã — o painel mostra "foto expirada".

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
  env: { UPLOAD_DIR: "/tmp/uploads-test" } as Record<string, string>,
  findMany: vi.fn(
    (_args?: {
      select: { id: true; path: true };
      where: { createdAt: { lt: Date } };
    }): Promise<{ id: string; path: string }[]> => Promise.resolve([])
  ),
  info: vi.fn(),
  unlink: vi.fn(() => Promise.resolve()),
}));

vi.mock("node:fs/promises", () => ({
  default: { unlink: mocks.unlink },
}));

vi.mock("../../config/env.js", () => ({
  loadEnv: () => mocks.env,
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: mocks.info },
}));

import { cleanupPontoPhotos } from "../ponto-photos.service.js";

const prisma = () =>
  ({
    pontoPhoto: {
      deleteMany: mocks.deleteMany,
      findMany: mocks.findMany,
    },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

describe("cleanupPontoPhotos", () => {
  it("sem fotos antigas → 0 e nada apaga", async () => {
    const n = await cleanupPontoPhotos(prisma());
    expect(n).toBe(0);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("fotos >90 dias → apaga linhas e ficheiros; cutoff é 90 dias", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "p1", path: "ponto-photos/u1/a.jpg" },
      { id: "p2", path: "ponto-photos/u1/b.jpg" },
    ]);

    const n = await cleanupPontoPhotos(prisma());

    expect(n).toBe(2);
    const where = mocks.findMany.mock.calls[0]?.[0];
    const cutoff = where?.where.createdAt.lt.getTime() ?? 0;
    // cutoff ≈ agora − 90 dias (±1 min de margem).
    expect(Date.now() - 90 * 86_400_000 - cutoff).toBeLessThan(60_000);
    expect(Date.now() - 90 * 86_400_000 - cutoff).toBeGreaterThan(-60_000);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
    });
    expect(mocks.unlink).toHaveBeenCalledTimes(2);
    expect(mocks.unlink).toHaveBeenCalledWith(expect.stringContaining("a.jpg"));
  });

  it("path fora do UPLOAD_DIR nunca é apagado", async () => {
    mocks.findMany.mockResolvedValue([{ id: "p1", path: "../../etc/passwd" }]);

    await cleanupPontoPhotos(prisma());

    // A linha sai, mas o ficheiro fora da base fica intacto.
    expect(mocks.deleteMany).toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
});
