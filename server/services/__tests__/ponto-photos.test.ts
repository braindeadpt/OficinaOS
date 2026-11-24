import { beforeEach, describe, expect, it, vi } from "vitest";

// Purga RGPD das fotos de prova do ponto: linhas PontoPhoto com mais de
// 90 dias são apagadas (linha + ficheiro); o TimeEntry fica com a
// referência órfã — o painel mostra "foto expirada". A linha só sai
// DEPOIS do ficheiro: um unlink falhado mantém-na para a ronda seguinte
// (antes, o ficheiro ficava órfão sem referência).

const mocks = vi.hoisted(() => ({
  deleteOne: vi.fn(() => Promise.resolve({})),
  env: { UPLOAD_DIR: "/tmp/uploads-test" } as Record<string, string>,
  findMany: vi.fn(
    (_args?: {
      select: { id: true; path: true };
      where: { createdAt: { lt: Date } };
    }): Promise<{ id: string; path: string }[]> => Promise.resolve([])
  ),
  info: vi.fn(),
  unlink: vi.fn(() => Promise.resolve()),
  warn: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { unlink: mocks.unlink },
}));

vi.mock("../../config/env.js", () => ({
  loadEnv: () => mocks.env,
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: mocks.info, warn: mocks.warn },
}));

import { cleanupPontoPhotos } from "../ponto-photos.service.js";

const prisma = () =>
  ({
    pontoPhoto: {
      delete: mocks.deleteOne,
      findMany: mocks.findMany,
    },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.unlink.mockResolvedValue(undefined);
});

describe("cleanupPontoPhotos", () => {
  it("sem fotos antigas → 0 e nada apaga", async () => {
    const n = await cleanupPontoPhotos(prisma());
    expect(n).toBe(0);
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("fotos >90 dias → ficheiro primeiro, linha depois; cutoff é 90 dias", async () => {
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
    expect(mocks.unlink).toHaveBeenCalledTimes(2);
    expect(mocks.unlink).toHaveBeenCalledWith(expect.stringContaining("a.jpg"));
    expect(mocks.deleteOne).toHaveBeenCalledTimes(2);
    expect(mocks.deleteOne).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(mocks.deleteOne).toHaveBeenCalledWith({ where: { id: "p2" } });
    // Ficheiro ANTES da linha — a ordem das chamadas por foto é unlink→delete.
    const unlinkOrder = mocks.unlink.mock.invocationCallOrder;
    const deleteOrder = mocks.deleteOne.mock.invocationCallOrder;
    expect(unlinkOrder[0]).toBeLessThan(deleteOrder[0]);
    expect(unlinkOrder[1]).toBeLessThan(deleteOrder[1]);
  });

  it("unlink falha (EACCES) → linha mantida para a ronda seguinte", async () => {
    // A falha de remoção não pode apagar a referência: a ronda seguinte
    // re-tenta depois de corrigidas as permissões.
    mocks.findMany.mockResolvedValue([
      { id: "p1", path: "ponto-photos/u1/a.jpg" },
    ]);
    mocks.unlink.mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" })
    );

    const n = await cleanupPontoPhotos(prisma());

    expect(n).toBe(0);
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();

    // Ronda seguinte, permissões corrigidas → a mesma linha apaga-se.
    mocks.unlink.mockResolvedValue(undefined);
    const n2 = await cleanupPontoPhotos(prisma());
    expect(n2).toBe(1);
    expect(mocks.deleteOne).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("ENOENT conta como sucesso — a linha sai na mesma", async () => {
    // Interrupção entre unlink e delete na ronda anterior: o ficheiro
    // já não existe, a linha sim — a purga é recuperável.
    mocks.findMany.mockResolvedValue([
      { id: "p1", path: "ponto-photos/u1/a.jpg" },
    ]);
    mocks.unlink.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );

    const n = await cleanupPontoPhotos(prisma());

    expect(n).toBe(1);
    expect(mocks.deleteOne).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("path fora do UPLOAD_DIR → ficheiro intacto e linha mantida", async () => {
    mocks.findMany.mockResolvedValue([{ id: "p1", path: "../../etc/passwd" }]);

    const n = await cleanupPontoPhotos(prisma());

    expect(n).toBe(0);
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });
});
