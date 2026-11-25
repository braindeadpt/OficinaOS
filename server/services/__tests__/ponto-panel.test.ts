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

  it("ordena pelo instante da decisão mais recente, não da picagem", async () => {
    // Picagem ANTIGA decidida agora tem de aparecer primeiro — por
    // `at` ficava enterrada atrás de picagens recentes e o gestor não
    // conseguia reverter a decisão que acabou de tomar.
    const mk = (
      id: string,
      punchIso: string,
      decisionIso: string,
      decision: string
    ) => ({
      at: new Date(punchIso),
      corrections: [],
      corrects: null,
      createdAt: new Date(punchIso),
      createdBy: null,
      id,
      proofs: {},
      reason: null,
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
      user: { id: "u-1", name: "Ana", phoneE164: null, username: "ana" },
      validations: [
        {
          at: new Date(decisionIso),
          byUser: { name: "Gestor", username: "gestor" },
          decision,
          id: `v-${id}`,
          note: null,
        },
      ],
    });
    // O Prisma devolve por `at` desc — a picagem recente vem primeiro.
    const rows = [
      mk(
        "recente",
        "2026-01-09T18:00:00.000Z",
        "2026-01-09T18:30:00.000Z",
        "APROVADO"
      ),
      mk(
        "antiga",
        "2026-01-05T18:00:00.000Z",
        "2026-01-10T11:00:00.000Z",
        "RECUSADO"
      ),
    ];
    const findMany = vi.fn(() => Promise.resolve(rows));
    const prisma = {
      pontoPhoto: { findMany: vi.fn(() => Promise.resolve([])) },
      timeEntry: { findMany },
    } as unknown as DbClient;

    const out = await listRecentDecisions(
      prisma,
      new Date("2026-01-10T12:00:00.000Z")
    );

    // A decidida AGORA (picagem antiga) lidera a lista.
    expect(out.map((e) => e.id)).toEqual(["antiga", "recente"]);
    expect(out[0]?.effectiveStatus).toBe("RECUSADO");
  });

  it("ordena ANTES do corte de 50 — decisão nova em picagem antiga sobrevive", async () => {
    // 51 picagens ordenadas por `at` desc (como o Prisma devolve): a
    // 51.ª — a picagem mais antiga — tem a decisão mais RECENTE. Se o
    // serviço cortasse antes de ordenar, essa linha nunca entrava no
    // painel e a decisão acabada de tomar era irreversível.
    const mk = (id: string, punchIso: string, decisionIso: string) => ({
      at: new Date(punchIso),
      corrections: [],
      corrects: null,
      createdAt: new Date(punchIso),
      createdBy: null,
      id,
      proofs: {},
      reason: null,
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
      user: { id: "u-1", name: "Ana", phoneE164: null, username: "ana" },
      validations: [
        {
          at: new Date(decisionIso),
          byUser: { name: "Gestor", username: "gestor" },
          decision: "APROVADO",
          id: `v-${id}`,
          note: null,
        },
      ],
    });
    const rows: ReturnType<typeof mk>[] = [];
    for (let i = 0; i < 51; i += 1) {
      // picagens desc: índice maior = picagem mais antiga
      const punch = new Date(
        Date.UTC(2026, 0, 27, 8, 0) - i * 60_000
      ).toISOString();
      // decisões asc pelo índice: a picagem mais antiga (i=50) decide-se por último
      const decision = new Date(
        Date.UTC(2026, 0, 28, 8, 0) + i * 60_000
      ).toISOString();
      rows.push(mk(`e-${i}`, punch, decision));
    }
    const findMany = vi.fn(() => Promise.resolve(rows));
    const prisma = {
      pontoPhoto: { findMany: vi.fn(() => Promise.resolve([])) },
      timeEntry: { findMany },
    } as unknown as DbClient;

    const out = await listRecentDecisions(
      prisma,
      new Date("2026-01-28T12:00:00.000Z")
    );

    expect(out).toHaveLength(50);
    // a decisão mais recente — da picagem mais antiga — lidera e NÃO cai no corte
    expect(out[0]?.id).toBe("e-50");
    // a decisão mais antiga é a única que fica de fora
    expect(out.some((e) => e.id === "e-0")).toBe(false);
  });
});
