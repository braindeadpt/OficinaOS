import { describe, expect, it, vi } from "vitest";

// Consultas do livro de ponto: pontoEntriesSince alimenta o ESTADO —
// tem de excluir entries superseded (correctsId apontado), senão a
// SAIDA presumida continuava a contar depois de corrigida (horas a
// dobrar e pendências contadas em duplicado).

import type { DbClient } from "../../../repositories/types.js";
import { pontoEntriesSince } from "../entries.js";

describe("pontoEntriesSince — só marcações efetivas", () => {
  it("where exclui entries com correção (superseded) — ESTADO não conta a presumida corrigida", async () => {
    const findMany = vi.fn((_args: unknown) => Promise.resolve([]));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;
    const since = new Date("2026-01-05T00:00:00.000Z");

    await pontoEntriesSince(prisma, "user-1", since);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      at: { gte: since },
      corrections: { none: {} },
      userId: "user-1",
    });
  });
});
