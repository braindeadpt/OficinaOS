import { describe, expect, it, vi } from "vitest";

// Consultas do livro de ponto: pontoEntriesSince alimenta o ESTADO —
// tem de excluir entries superseded (correctsId apontado), senão a
// SAIDA presumida continuava a contar depois de corrigida (horas a
// dobrar e pendências contadas em duplicado). As recusas da gerência
// filtram-se em memória pela decisão MAIS RECENTE: uma recusa seguida
// de re-aprovação no painel não pode esconder a marcação (o filtro
// `none` na query excluía a linha mesmo depois de re-aprovada).

import type { DbClient } from "../../../repositories/types.js";
import { zonedDateTimeToUtc } from "../../../utils/time-range.js";
import {
  findOpenPresumedExit,
  pontoEntriesSince,
  todayPontoEntries,
} from "../entries.js";
import { workedMs } from "../handler.js";

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

describe("findOpenPresumedExit — janela rolling de 24 h (R2-A)", () => {
  function prismaFor(
    presumedRows: {
      at: Date;
      id: string;
      validations: { decision: string }[];
    }[],
    entryRows: {
      at: Date;
      id: string;
      validations: { decision: string }[];
    }[] = []
  ) {
    let call = 0;
    const findMany = vi.fn((args: unknown) => {
      call += 1;
      const rows = call === 1 ? presumedRows : entryRows;
      const at = (args as { where?: { at?: Record<string, Date> } }).where?.at;
      return Promise.resolve(
        rows.filter(
          (r) =>
            (!at?.gte || r.at >= at.gte) &&
            (!at?.gt || r.at > at.gt) &&
            (!at?.lte || r.at <= at.lte) &&
            (!at?.lt || r.at < at.lt)
        )
      );
    });
    return {
      findMany,
      prisma: { timeEntry: { findMany } } as unknown as DbClient,
    };
  }

  it.each([
    "Europe/Lisbon",
    "Atlantic/Azores",
  ])("presumida às 23:55 é encontrada pela SAIDA real às 00:10 em %s — corrige e não duplica horas", async (tz) => {
    const zoned = (ymd: string, hhmm: string) => {
      const date = zonedDateTimeToUtc(tz, ymd, hhmm);
      if (!date) {
        throw new Error("data inválida no teste");
      }
      return date;
    };
    const presumedAt = zoned("2026-01-10", "23:55");
    const now = zoned("2026-01-11", "00:10");
    const { prisma } = prismaFor([
      { at: presumedAt, id: "presumida-vespera", validations: [] },
    ]);

    const open = await findOpenPresumedExit(prisma, "user-1", tz, now);

    expect(open).toMatchObject({ id: "presumida-vespera" });
    // A correção fica ligada à presumida; nos cálculos entra só a saída
    // efetiva. Pela regra sem overnight, 20:00→meia-noite são 4h00 —
    // nunca 8h00 por duplicar a presumida nem 4h10 por atravessar o dia.
    const effective = [
      { at: zoned("2026-01-10", "20:00"), type: "ENTRADA" },
      { at: now, correctsId: open?.id, type: "SAIDA" },
    ];
    expect(effective.filter((e) => e.type === "SAIDA")).toHaveLength(1);
    expect(workedMs(effective, tz, now)).toBe(4 * 3_600_000);
  });

  it("turno noturno real com ENTRADA depois da presumida não é corrigido", async () => {
    const now = new Date("2026-01-11T00:10:00.000Z");
    const { prisma } = prismaFor(
      [
        {
          at: new Date("2026-01-10T18:00:00.000Z"),
          id: "presumida-turno-anterior",
          validations: [],
        },
      ],
      [
        {
          at: new Date("2026-01-10T22:00:00.000Z"),
          id: "entrada-turno-noturno",
          validations: [],
        },
      ]
    );

    await expect(
      findOpenPresumedExit(prisma, "user-1", "Europe/Lisbon", now)
    ).resolves.toBeNull();
  });

  it("a janela é de 24 h reais mesmo na mudança de hora de fim de outubro", async () => {
    const now = new Date("2026-10-25T12:00:00.000Z");
    const { findMany, prisma } = prismaFor([]);

    await findOpenPresumedExit(prisma, "user-1", "Europe/Lisbon", now);

    const args = findMany.mock.calls[0]?.[0] as {
      where: { at: Record<string, Date> };
    };
    expect(args.where.at.gte?.toISOString()).toBe("2026-10-24T12:00:00.000Z");
    expect(args.where.at.lte).toBe(now);
  });
});
