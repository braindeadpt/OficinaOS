import { describe, expect, it, vi } from "vitest";

// Fila de validação do livro de ponto: uma linha já corrigida (a
// correção é outra entrada — aprovada ou ela própria pendente) não
// pode continuar na fila — validá-la já não muda o apuramento e
// escondia a correção que realmente precisa de decisão.

import type { DbClient } from "../../repositories/types.js";
import { listPending, listRecentDecisions } from "../ponto-panel.service.js";

describe("listPending", () => {
  it("exclui linhas já corrigidas da fila de validação", async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const prisma = {
      timeEntry: { findMany },
    } as unknown as DbClient;

    const rows = await listPending(prisma);

    expect(rows).toEqual([]);
    const call = findMany.mock.calls[0] as unknown[] | undefined;
    const where = (call?.[0] as { where: object }).where;
    expect(where).toMatchObject({
      corrections: { none: {} },
      status: "POR_VALIDAR",
      validations: { none: {} },
    });
  });
});

describe("listRecentDecisions", () => {
  it("traz decisões dos últimos 7 dias sem substituídas — a reversão precisa da lista", async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const prisma = {
      pontoPhoto: { findMany: vi.fn(() => Promise.resolve([])) },
      timeEntry: { findMany },
    } as unknown as DbClient;

    const rows = await listRecentDecisions(prisma);

    expect(rows).toEqual([]);
    const call = findMany.mock.calls[0] as unknown[] | undefined;
    const where = (call?.[0] as { where: object }).where;
    expect(where).toMatchObject({
      corrections: { none: {} },
      validations: { some: { at: { gte: expect.any(Date) } } },
    });
  });

  it("decisão mais recente fora dos 7 dias fica de fora mesmo com validação antiga dentro", async () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const entry = {
      at: new Date("2026-01-01T18:00:00.000Z"),
      corrections: [],
      corrects: null,
      createdAt: new Date("2026-01-01T18:00:00.000Z"),
      createdBy: null,
      id: "e-1",
      proofs: {},
      reason: null,
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
      user: { id: "u-1", name: "Ana", phoneE164: null, username: "ana" },
      // Ordenadas desc: a mais recente (8 dias) está fora da janela
      // mesmo havendo uma mais antiga dentro — a decisão que conta é
      // a mais recente.
      validations: [
        {
          at: new Date("2026-01-02T12:00:00.000Z"),
          byUser: { name: "Gestor", username: "gestor" },
          decision: "APROVADO",
          id: "v-2",
          note: null,
        },
        {
          at: new Date("2026-01-09T12:00:00.000Z"),
          byUser: { name: "Gestor", username: "gestor" },
          decision: "RECUSADO",
          id: "v-1",
          note: null,
        },
      ],
    };
    const findMany = vi.fn(() => Promise.resolve([entry]));
    const prisma = {
      pontoPhoto: { findMany: vi.fn(() => Promise.resolve([])) },
      timeEntry: { findMany },
    } as unknown as DbClient;

    // Com validação mais recente há 8 dias (02/01 → 10/01) — fora.
    const rows = await listRecentDecisions(prisma, now);
    expect(rows).toEqual([]);

    // Uma decisão de ontem entra e traz as fotos no formato do painel.
    entry.validations = [
      {
        at: new Date("2026-01-09T12:00:00.000Z"),
        byUser: { name: "Gestor", username: "gestor" },
        decision: "RECUSADO",
        id: "v-1",
        note: null,
      },
    ];
    const rows2 = await listRecentDecisions(prisma, now);
    expect(rows2).toHaveLength(1);
    expect(rows2[0]?.effectiveStatus).toBe("RECUSADO");
  });
});
