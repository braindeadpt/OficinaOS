import { describe, expect, it, vi } from "vitest";

// Consultas do livro de ponto: pontoEntriesSince alimenta o ESTADO —
// tem de excluir entries superseded (correctsId apontado), senão a
// SAIDA presumida continuava a contar depois de corrigida (horas a
// dobrar e pendências contadas em duplicado). As recusas da gerência
// filtram-se em memória pela decisão MAIS RECENTE: uma recusa seguida
// de re-aprovação no painel não pode esconder a marcação (o filtro
// `none` na query excluía a linha mesmo depois de re-aprovada).

import type { DbClient } from "../../../repositories/types.js";
import {
  findOpenPresumedExit,
  pontoEntriesSince,
  todayPontoEntries,
} from "../entries.js";

function entry(over: Record<string, unknown>) {
  return {
    at: new Date("2026-01-10T09:00:00.000Z"),
    corrects: null,
    status: "APROVADO",
    type: "ENTRADA",
    validations: [],
    ...over,
  };
}

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
    // O filtro de recusa NÃO vai na query — é em memória pela decisão
    // mais recente, senão uma re-aprovação não recuperava a linha.
    expect(args.where).not.toHaveProperty("validations");
  });

  it("recusa mais recente esconde a linha; re-aprovação recupera-a", async () => {
    const rows = [
      entry({ id: "sem-validacao" }),
      entry({ id: "recusado", validations: [{ decision: "RECUSADO" }] }),
      // Re-aprovado: a validação mais recente (desc, take 1) é APROVADO
      // mesmo havendo uma recusa anterior no histórico.
      entry({ id: "reaprovado", validations: [{ decision: "APROVADO" }] }),
    ];
    const findMany = vi.fn((_args: unknown) => Promise.resolve(rows));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    const out = await pontoEntriesSince(prisma, "user-1", new Date());

    const ids = out.map((e) => (e as { id?: string }).id);
    expect(ids).toEqual(["sem-validacao", "reaprovado"]);
  });

  it("a select traz a decisão mais recente — sem ela um registo decidido contava como «por validar»", async () => {
    const findMany = vi.fn((_args: unknown) => Promise.resolve([]));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    await pontoEntriesSince(prisma, "user-1", new Date());

    const args = findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
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
  it("where exclui superseded; recusa filtra em memória pela decisão mais recente", async () => {
    const rows = [
      entry({ id: "recusado", validations: [{ decision: "RECUSADO" }] }),
      entry({ id: "reaprovado", validations: [{ decision: "APROVADO" }] }),
    ];
    const findMany = vi.fn((_args: unknown) => Promise.resolve(rows));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    const out = await todayPontoEntries(prisma, "user-1", "Europe/Lisbon");

    const args = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      corrections: { none: {} },
      userId: "user-1",
    });
    expect(args.where).not.toHaveProperty("validations");
    // Entrada recusada não é pré-requisito de PAUSA/VOLTEI/SAIDA, mas
    // uma re-aprovação no painel volta a contar.
    const ids = out.map((e) => (e as { id?: string }).id);
    expect(ids).toEqual(["reaprovado"]);
  });
});

describe("findOpenPresumedExit — gate de rejeição", () => {
  it("presumida recusada não é oferecida — SAIDA normal não substitui a recusa do gestor", async () => {
    const rows = [
      {
        at: new Date("2026-01-10T18:30:00.000Z"),
        id: "presumida-1",
        validations: [{ decision: "RECUSADO" }],
      },
    ];
    const findMany = vi.fn((_args: unknown) => Promise.resolve(rows));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    const out = await findOpenPresumedExit(prisma, "user-1", "Europe/Lisbon");

    expect(out).toBeNull();
    const args = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      corrections: { none: {} },
      type: "SAIDA",
      userId: "user-1",
    });
    expect(args.where).not.toHaveProperty("validations");
  });

  it("presumida aberta sem recusa é devolvida", async () => {
    const rows = [
      {
        at: new Date("2026-01-10T18:30:00.000Z"),
        id: "presumida-1",
        validations: [],
      },
    ];
    const findMany = vi.fn((_args: unknown) => Promise.resolve(rows));
    const prisma = { timeEntry: { findMany } } as unknown as DbClient;

    const out = await findOpenPresumedExit(prisma, "user-1", "Europe/Lisbon");

    expect(out).toMatchObject({ id: "presumida-1" });
  });
});
