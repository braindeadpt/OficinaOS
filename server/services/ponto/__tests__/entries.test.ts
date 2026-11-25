import { describe, expect, it, vi } from "vitest";

// Consultas do livro de ponto: pontoEntriesSince alimenta o ESTADO —
// tem de excluir entries superseded (correctsId apontado), senão a
// SAIDA presumida continuava a contar depois de corrigida (horas a
// dobrar e pendências contadas em duplicado).

import type { DbClient } from "../../../repositories/types.js";
import {
  findOpenPresumedExit,
  pontoEntriesSince,
  todayPontoEntries,
} from "../entries.js";

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
      validations: { none: { decision: "RECUSADO" } },
    });
  });

  it("where exclui recusados pela gerência e a select traz a decisão — recusado não conta horas nem pendência", async () => {
    const findMany = vi.fn((_args: unknown) => Promise.resolve([]));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    await pontoEntriesSince(prisma, "user-1", new Date());

    const args = findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      validations: { none: { decision: "RECUSADO" } },
    });
    // A decisão mais recente vem na linha — o status é append-only e
    // sem ela um registo já decidido contava como «por validar».
    expect(args.select).toMatchObject({
      validations: {
        orderBy: { at: "desc" },
        select: { decision: true },
        take: 1,
      },
    });
  });
});

describe("todayPontoEntries — gates do dia", () => {
  it("where exclui superseded e recusados — entrada anulada não é pré-requisito", async () => {
    const findMany = vi.fn((_args: unknown) => Promise.resolve([]));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    await todayPontoEntries(prisma, "user-1", "Europe/Lisbon");

    const args = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      corrections: { none: {} },
      userId: "user-1",
      validations: { none: { decision: "RECUSADO" } },
    });
  });
});

describe("findOpenPresumedExit — gate de rejeição", () => {
  it("where exclui presumidas recusadas — SAIDA normal não substitui a recusa do gestor", async () => {
    const findFirst = vi.fn((_args: unknown) => Promise.resolve(null));
    const prisma = { timeEntry: { findFirst } } as unknown as DbClient;

    await findOpenPresumedExit(prisma, "user-1", "Europe/Lisbon");

    const args = findFirst.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      corrections: { none: {} },
      type: "SAIDA",
      userId: "user-1",
      validations: { none: { decision: "RECUSADO" } },
    });
  });
});
