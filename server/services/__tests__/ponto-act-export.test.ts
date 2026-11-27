import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../repositories/types.js";
import { getPontoActExport } from "../ponto-act-export.service.js";
import { getHours, type PontoRange } from "../ponto-panel.service.js";

const TZ = "Europe/Lisbon";
const RANGE: PontoRange = {
  end: new Date("2026-01-06T00:00:00.000Z"),
  fromDate: "2026-01-05",
  start: new Date("2026-01-05T00:00:00.000Z"),
  toDate: "2026-01-05",
};
const NOW = new Date("2026-01-10T12:00:00.000Z");
const SHA256_HEX = /^[0-9a-f]{64}$/;

function user(id: string, name = `Worker ${id}`) {
  return {
    externalWork: false,
    id,
    name,
    pontoScheduleEnd: "18:00",
    pontoScheduleExempt: false,
    pontoScheduleStart: "09:00",
    username: id,
  };
}

function entry(args: {
  at: string;
  corrections?: unknown[];
  corrects?: unknown;
  correctsId?: string | null;
  createdAt?: string;
  createdBy?: { name: string; username: string } | null;
  id: string;
  reason?: string | null;
  status?: string;
  transport?: string;
  type: string;
  userId: string;
  validations?: unknown[];
}) {
  return {
    at: new Date(args.at),
    corrections: args.corrections ?? [],
    corrects: args.corrects ?? null,
    correctsId: args.correctsId ?? null,
    createdAt: new Date(args.createdAt ?? args.at),
    createdBy: args.createdBy ?? null,
    id: args.id,
    reason: args.reason ?? null,
    status: args.status ?? "APROVADO",
    transport: args.transport ?? "MANUAL",
    type: args.type,
    user: {
      id: args.userId,
      name: `Worker ${args.userId}`,
      username: args.userId,
    },
    userId: args.userId,
    validations: args.validations ?? [],
  };
}

function prismaWith(rows: unknown[], users: ReturnType<typeof user>[]) {
  const settings = {
    address: "Rua A, 1",
    phone: "+351210000000",
    shopLocality: "Porto",
    shopName: "Oficina Teste",
    shopTaxId: "501234567",
  };
  // Linhas "vivas": escritas a meio da exportação entram aqui. A transação
  // emulada tira um snapshot no INÍCIO (semântica REPEATABLE READ) e todas
  // as leituras dentro dela veem o snapshot — nunca as escritas posteriores.
  // O cliente da transação é um objeto DISTINTO do cliente principal: uma
  // leitura feita pelo cliente errado durante a transação fica contada em
  // __outerReadsDuringTx e o teste falha — antes disto ambos eram o mesmo
  // objeto e o teste passava mesmo com leituras fora da transação.
  const liveRows = [...rows];
  const state = {
    inTransaction: false,
    outerReadsDuringTx: 0,
    snapshot: null as unknown[] | null,
  };
  const makeModels = (source: () => unknown[], countEscape: boolean) => ({
    shopSettings: {
      findUnique: vi.fn(() => {
        if (countEscape && state.inTransaction) {
          state.outerReadsDuringTx += 1;
        }
        return Promise.resolve(settings);
      }),
    },
    timeEntry: {
      findMany: vi.fn((args?: { distinct?: unknown }) => {
        if (countEscape && state.inTransaction) {
          state.outerReadsDuringTx += 1;
        }
        const rows0 = source();
        if (args?.distinct) {
          return Promise.resolve(
            [
              ...new Set(rows0.map((r) => (r as { userId: string }).userId)),
            ].map((userId) => ({ userId }))
          );
        }
        return Promise.resolve(rows0);
      }),
    },
    user: {
      findMany: vi.fn(() => {
        if (countEscape && state.inTransaction) {
          state.outerReadsDuringTx += 1;
        }
        return Promise.resolve(users);
      }),
      findUnique: vi.fn(() => {
        if (countEscape && state.inTransaction) {
          state.outerReadsDuringTx += 1;
        }
        return Promise.resolve({
          id: "owner-1",
          name: "Dono",
          username: "dono",
        });
      }),
    },
  });
  const client = {
    __isolationLevel: undefined as unknown,
    ...makeModels(() => liveRows, true),
    $transaction: vi.fn(
      async (
        callback: (tx: unknown) => Promise<unknown>,
        options?: { isolationLevel?: unknown }
      ) => {
        client.__isolationLevel = options?.isolationLevel;
        state.snapshot = [...liveRows];
        state.inTransaction = true;
        const tx = makeModels(() => state.snapshot ?? [], false);
        try {
          return await callback(tx);
        } finally {
          state.inTransaction = false;
          state.snapshot = null;
        }
      }
    ),
    __liveRows: liveRows,
    __state: state,
  };
  return client as unknown as DbClient & {
    __isolationLevel: unknown;
    __liveRows: unknown[];
    __state: { outerReadsDuringTx: number };
  };
}

describe("exportação ACT do livro de ponto", () => {
  it("mantém o original ao lado da correção e os totais batem certo com o painel", async () => {
    const manager = { name: "Gestora", username: "gestora" };
    const originalBase = entry({
      at: "2026-01-05T17:00:00.000Z",
      id: "original",
      type: "SAIDA",
      userId: "u1",
    });
    const correctionBase = entry({
      at: "2026-01-05T18:00:00.000Z",
      createdAt: "2026-01-06T09:00:00.000Z",
      createdBy: manager,
      correctsId: "original",
      id: "correction",
      reason: "esqueceu-se de picar à saída",
      type: "SAIDA",
      userId: "u1",
    });
    const original = {
      ...originalBase,
      corrections: [correctionBase],
    };
    const correction = {
      ...correctionBase,
      corrects: originalBase,
    };
    const rows = [
      entry({
        at: "2026-01-05T09:00:00.000Z",
        id: "in",
        type: "ENTRADA",
        userId: "u1",
      }),
      entry({
        at: "2026-01-05T13:00:00.000Z",
        id: "pause",
        type: "PAUSA",
        userId: "u1",
      }),
      entry({
        at: "2026-01-05T14:00:00.000Z",
        id: "back",
        type: "VOLTEI",
        userId: "u1",
      }),
      original,
      correction,
    ];
    const prisma = prismaWith(rows, [user("u1", "Ana")]);

    const out = await getPontoActExport(
      prisma,
      { actorId: "owner-1", range: RANGE, tz: TZ },
      NOW
    );

    expect(out.company).toMatchObject({
      locality: "Porto",
      name: "Oficina Teste",
      taxId: "501234567",
    });
    expect(out.exportedBy.name).toBe("Dono");
    expect(out.contentHash).toMatch(SHA256_HEX);
    const worker = out.workers[0];
    expect(worker?.scheduleExempt).toBe(false);
    const day = worker?.days[0];
    expect(day?.entries).toHaveLength(5);
    const exportedOriginal = day?.entries.find((e) => e.id === "original");
    expect(exportedOriginal?.superseded).toBe(true);
    expect(exportedOriginal?.corrections[0]).toMatchObject({
      createdByName: "Gestora",
      id: "correction",
      reason: "esqueceu-se de picar à saída",
    });
    const exportedCorrection = day?.entries.find((e) => e.id === "correction");
    expect(exportedCorrection?.corrects?.id).toBe("original");
    expect(day?.pauseMinutes).toBe(60);
    expect(day?.workedMinutes).toBe(480);
    expect(worker?.weeks).toEqual([
      { end: "2026-01-11", start: "2026-01-05", workedMinutes: 480 },
    ]);

    const panel = await getHours(prisma, TZ, RANGE, undefined);
    expect(day?.workedMinutes).toBe(panel.days[0]?.hours.workedMinutes);
  });

  it("inclui no original uma correção cujo instante cai fora do período", async () => {
    const correction = entry({
      at: "2026-01-06T09:00:00.000Z",
      createdAt: "2026-01-07T10:00:00.000Z",
      createdBy: { name: "Gestora", username: "gestora" },
      correctsId: "original",
      id: "late-correction",
      reason: "correção pedida depois da inspeção",
      type: "SAIDA",
      userId: "u1",
    });
    const original = {
      ...entry({
        at: "2026-01-05T17:00:00.000Z",
        id: "original",
        type: "SAIDA",
        userId: "u1",
      }),
      corrections: [correction],
    };
    const rows = [
      entry({
        at: "2026-01-05T09:00:00.000Z",
        id: "in",
        type: "ENTRADA",
        userId: "u1",
      }),
      original,
    ];
    const out = await getPontoActExport(
      prismaWith(rows, [user("u1", "Ana")]),
      { actorId: "owner-1", range: RANGE, tz: TZ },
      NOW
    );

    const exportedOriginal = out.workers[0]?.days[0]?.entries.find(
      (e) => e.id === "original"
    );
    expect(exportedOriginal?.corrections[0]).toMatchObject({
      id: "late-correction",
      reason: "correção pedida depois da inspeção",
    });
    expect(
      out.workers[0]?.days[0]?.entries.some((e) => e.id === "late-correction")
    ).toBe(false);
  });

  it("uma picagem nova a meio da exportação não entra nem nas linhas nem nos totais", async () => {
    // O snapshot REPEATABLE READ é tirado no início da transação: um INSERT
    // concorrente não pode aparecer nos totais sem aparecer nas linhas (ou
    // vice-versa). Se alguma leitura fugir para fora da transação, este
    // teste falha — as linhas e os totais divergem.
    const rows = [
      entry({
        at: "2026-01-05T09:00:00.000Z",
        id: "in",
        type: "ENTRADA",
        userId: "u1",
      }),
      entry({
        at: "2026-01-05T17:00:00.000Z",
        id: "out",
        type: "SAIDA",
        userId: "u1",
      }),
    ];
    const prisma = prismaWith(rows, [user("u1", "Ana")]);
    // A "escrita concorrente" acontece dentro da transação, depois de o
    // snapshot estar tirado e antes das leituras da exportação. Como o
    // cliente da transação é distinto do cliente principal, qualquer
    // leitura que fuja da transação vê as linhas tardias E incrementa o
    // contador — as duas deteções falham o teste.
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = vi.fn(
      (
        callback: (tx: unknown) => Promise<unknown>,
        options?: { isolationLevel?: unknown }
      ) =>
        (originalTransaction as (cb: unknown, o: unknown) => unknown)(
          (tx: unknown) => {
            prisma.__liveRows.push(
              entry({
                at: "2026-01-05T18:00:00.000Z",
                id: "late-in",
                type: "ENTRADA",
                userId: "u1",
              }),
              entry({
                at: "2026-01-05T19:00:00.000Z",
                id: "late-out",
                type: "SAIDA",
                userId: "u1",
              })
            );
            return callback(tx);
          },
          options
        )
    ) as never;

    const out = await getPontoActExport(
      prisma,
      { actorId: "owner-1", range: RANGE, tz: TZ },
      NOW
    );

    expect(prisma.__isolationLevel).toBe("RepeatableRead");
    // Prova direta: nenhuma leitura da exportação fugiu da transação.
    expect(prisma.__state.outerReadsDuringTx).toBe(0);
    const worker = out.workers[0];
    const day = worker?.days[0];
    // Nem as linhas nem os totais veem a picagem tardia: 2 eventos, 8 h.
    expect(day?.entries.map((e) => e.id)).toEqual(["in", "out"]);
    expect(day?.workedMinutes).toBe(480);
    expect(worker?.totalMinutes).toBe(480);
  });

  it("as correções ligadas trazem o estado de validação, o autor e a data", async () => {
    const validation = {
      at: new Date("2026-01-06T10:00:00.000Z"),
      byUser: { name: "Dono", username: "dono" },
      decision: "APROVADO",
      note: "conferido com o trabalhador",
    };
    const correction = {
      ...entry({
        at: "2026-01-06T09:00:00.000Z",
        createdAt: "2026-01-06T08:30:00.000Z",
        correctsId: "original",
        id: "correction",
        type: "SAIDA",
        userId: "u1",
      }),
      validations: [validation],
    };
    const original = {
      ...entry({
        at: "2026-01-05T17:00:00.000Z",
        id: "original",
        type: "SAIDA",
        userId: "u1",
      }),
      corrections: [correction],
    };
    const out = await getPontoActExport(
      prismaWith([original], [user("u1", "Ana")]),
      { actorId: "owner-1", range: RANGE, tz: TZ },
      NOW
    );

    const exported = out.workers[0]?.days[0]?.entries.find(
      (e) => e.id === "original"
    );
    // A correção cai fora do período (6 jan) — mesmo assim o estado da
    // decisão, quem decidiu e quando viajam no documento.
    expect(exported?.corrections[0]?.validations).toEqual([
      {
        at: "2026-01-06T10:00:00.000Z",
        byUserName: "Dono",
        decision: "APROVADO",
        note: "conferido com o trabalhador",
      },
    ]);
  });

  it("30 trabalhadores × 1 mês são agregados em menos de 5 segundos", async () => {
    const users = Array.from({ length: 30 }, (_, i) => user(`u${i + 1}`));
    const rows: unknown[] = [];
    for (const u of users) {
      for (let day = 1; day <= 31; day += 1) {
        const d = String(day).padStart(2, "0");
        rows.push(
          entry({
            at: `2026-01-${d}T09:00:00.000Z`,
            id: `${u.id}-${d}-in`,
            type: "ENTRADA",
            userId: u.id,
          }),
          entry({
            at: `2026-01-${d}T13:00:00.000Z`,
            id: `${u.id}-${d}-pause`,
            type: "PAUSA",
            userId: u.id,
          }),
          entry({
            at: `2026-01-${d}T14:00:00.000Z`,
            id: `${u.id}-${d}-back`,
            type: "VOLTEI",
            userId: u.id,
          }),
          entry({
            at: `2026-01-${d}T18:00:00.000Z`,
            id: `${u.id}-${d}-out`,
            type: "SAIDA",
            userId: u.id,
          })
        );
      }
    }
    const range: PontoRange = {
      end: new Date("2026-02-01T00:00:00.000Z"),
      fromDate: "2026-01-01",
      start: new Date("2026-01-01T00:00:00.000Z"),
      toDate: "2026-01-31",
    };
    const started = performance.now();
    const out = await getPontoActExport(
      prismaWith(rows, users),
      { actorId: "owner-1", range, tz: TZ },
      new Date("2026-02-02T12:00:00.000Z")
    );
    const elapsed = performance.now() - started;

    expect(out.workers).toHaveLength(30);
    expect(out.workers[0]?.days).toHaveLength(31);
    expect(elapsed).toBeLessThan(5000);
  });
});
