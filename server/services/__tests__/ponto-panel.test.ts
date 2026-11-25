import { describe, expect, it, vi } from "vitest";

// Fila de validação do livro de ponto: uma linha já corrigida (a
// correção é outra entrada — aprovada ou ela própria pendente) não
// pode continuar na fila — validá-la já não muda o apuramento e
// escondia a correção que realmente precisa de decisão.

import type { DbClient } from "../../repositories/types.js";
import {
  getHours,
  getMissingExits,
  listPending,
  listRecentDecisions,
} from "../ponto-panel.service.js";

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

describe("emparelhamento sem overnight (decisão 2026-11-25)", () => {
  // Cenário do review: ENTRADA seg 09:00 sem saída; ENTRADA ter 09:00
  // REJEITADA; SAIDA ter 18:00 válida. Antes a SAIDA de terça fechava o
  // turno de segunda e contava a noite inteira (~33 h).
  const TZ = "Europe/Lisbon";

  function row(id: string, iso: string, type: string, decision: string | null) {
    return {
      at: new Date(iso),
      corrections: [],
      corrects: null,
      createdAt: new Date(iso),
      id,
      proofs: {},
      status: decision ? "POR_VALIDAR" : "APROVADO",
      type,
      userId: "u1",
      validations: decision
        ? [{ at: new Date(iso), decision, id: `v-${id}` }]
        : [],
    };
  }

  function prismaCom(rows: unknown[]) {
    return {
      timeEntry: {
        findMany: vi.fn((args?: { distinct?: unknown }) =>
          Promise.resolve(args?.distinct ? [{ userId: "u1" }] : rows)
        ),
      },
      user: {
        findMany: vi.fn(() =>
          Promise.resolve([{ id: "u1", name: "Zé", username: "ze" }])
        ),
      },
    } as unknown as DbClient;
  }

  const rows = [
    row("e1", "2026-01-05T09:00:00.000Z", "ENTRADA", null), // seg
    row("e2", "2026-01-06T09:00:00.000Z", "ENTRADA", "RECUSADO"), // ter — rejeitada
    row("e3", "2026-01-06T18:00:00.000Z", "SAIDA", null), // ter
  ];
  const range = {
    end: new Date("2026-01-12T00:00:00.000Z"),
    fromDate: "2026-01-05",
    start: new Date("2026-01-05T00:00:00.000Z"),
    toDate: "2026-01-11",
  };

  it("a SAIDA de terça NUNCA fecha o turno de segunda — sem as ~33 h", async () => {
    const out = await getHours(prismaCom(rows), TZ, range, undefined);
    const seg = out.days.find(
      (d) => d.date === "2026-01-05" && d.userId === "u1"
    );
    // Segunda corta no fim do próprio dia (09:00→24:00 = 900 min),
    // nunca atravessa a meia-noite.
    expect(seg?.hours.workedMinutes).toBe(900);
    // E fica esquecimento para o gestor fechar à mão.
    expect(seg?.hours.missingExit).toBe(true);
    // Terça não tem intervalo utilizável (ENTRADA rejeitada) — a SAIDA
    // órfã não conta horas nem para trás nem para a frente.
    const ter = out.days.find(
      (d) => d.date === "2026-01-06" && d.userId === "u1"
    );
    expect(ter?.hours.workedMinutes ?? 0).toBe(0);
  });

  it("fecho no MESMO dia civil continua a emparelhar (caso preservado)", async () => {
    const normais = [
      row("n1", "2026-01-05T09:00:00.000Z", "ENTRADA", null),
      row("n2", "2026-01-05T18:00:00.000Z", "SAIDA", null),
    ];
    const out = await getHours(prismaCom(normais), TZ, range, undefined);
    const seg = out.days.find(
      (d) => d.date === "2026-01-05" && d.userId === "u1"
    );
    expect(seg?.hours.workedMinutes).toBe(540);
    expect(seg?.hours.missingExit).toBe(false);
  });

  it("missing-exits lista a segunda — o fecho de terça não a resolve", async () => {
    const out = await getMissingExits(prismaCom(rows), TZ, range);
    expect(out.some((m) => m.date === "2026-01-05" && m.userId === "u1")).toBe(
      true
    );
  });
});
