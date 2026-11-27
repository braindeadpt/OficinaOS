import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// REGISTOS — direito de acesso (art. 15.º RGPD). Os testes cobrem o que
// a especificação exige: um trabalhador nunca recebe registos de outro
// (a query é sempre filtrada por userId e o token é dono de um único
// userId), um número desconhecido não recebe nada (não há staff → o
// handler nem sequer despacha — testado em staff/inbound; aqui prova-se
// que o token não existe para quem nunca o pediu), o link expira e só
// funciona uma vez, e um mês sem registos dá resposta clara.

import type { DbClient } from "../../../repositories/types.js";
import {
  consumeRegistosToken,
  monthSpecRange,
  parseMonthArg,
  registosMonthEntries,
  registosRateOk,
  summarizeMonth,
} from "../registos.js";

const TZ = "Europe/Lisbon";

function prismaWith(over: Record<string, unknown>): DbClient {
  return {
    pontoRegistosToken: {
      count: vi.fn(() => Promise.resolve(0)),
      create: vi.fn(() => Promise.resolve({})),
      findUnique: vi.fn(() => Promise.resolve(null)),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    timeEntry: { findMany: vi.fn(() => Promise.resolve([])) },
    ...over,
  } as unknown as DbClient;
}

describe("parseMonthArg", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");

  it("sem argumento → null (mês corrente)", () => {
    expect(parseMonthArg("registos", TZ, now)).toBeNull();
  });

  it("«registos 10 2026» (normalizado, barra virou espaço) → outubro 2026", () => {
    expect(parseMonthArg("registos 10 2026", TZ, now)).toEqual({
      month: 10,
      year: 2026,
    });
  });

  it("mês futuro → inválido", () => {
    expect(parseMonthArg("registos 12 2026", TZ, now)).toBeUndefined();
  });

  it("mês 13 ou formato errado → inválido", () => {
    expect(parseMonthArg("registos 13 2026", TZ, now)).toBeUndefined();
    expect(parseMonthArg("registos abc 2026", TZ, now)).toBeUndefined();
  });

  it("ano futuro → inválido", () => {
    expect(parseMonthArg("registos 1 2027", TZ, now)).toBeUndefined();
  });
});

describe("monthSpecRange — mês civil no fuso da loja", () => {
  it("novembro 2026 em Lisboa cobre o mês inteiro em UTC", () => {
    const { end, start } = monthSpecRange(TZ, { month: 11, year: 2026 });
    expect(start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("registosMonthEntries — isolamento por trabalhador", () => {
  it("a query filtra sempre por userId — um trabalhador nunca recebe registos de outro", async () => {
    const findMany = vi.fn((_args: unknown) => Promise.resolve([]));
    const prisma = prismaWith({ timeEntry: { findMany } });

    await registosMonthEntries(prisma, "user-A", TZ, {
      month: 11,
      year: 2026,
    });

    const args = findMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(args.where.userId).toBe("user-A");
  });

  it("correções contam-se pelas linhas que têm correção", async () => {
    const rows = [
      {
        at: new Date(),
        corrections: [],
        status: "APROVADO",
        type: "ENTRADA",
        validations: [],
      },
      {
        at: new Date(),
        corrections: [{ id: "c1" }],
        status: "APROVADO",
        type: "SAIDA",
        validations: [],
      },
    ];
    const prisma = prismaWith({
      timeEntry: { findMany: vi.fn(() => Promise.resolve(rows)) },
    });
    const out = await registosMonthEntries(prisma, "u", TZ, {
      month: 11,
      year: 2026,
    });
    expect(out.correctionsCount).toBe(1);
    expect(out.entries).toHaveLength(2);
  });
});

describe("summarizeMonth", () => {
  it("dia completo: entrada→pausa→voltei→saída soma trabalho e pausa", () => {
    const d = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 3, h, m)); // inverno: UTC == Lisboa
    const entries = [
      { at: d(9), status: "APROVADO", type: "ENTRADA", validations: [] },
      { at: d(13), status: "APROVADO", type: "PAUSA", validations: [] },
      { at: d(14), status: "APROVADO", type: "VOLTEI", validations: [] },
      { at: d(18), status: "POR_VALIDAR", type: "SAIDA", validations: [] },
    ];
    const s = summarizeMonth(entries, 0, TZ);
    expect(s.days).toBe(1);
    expect(s.workedMs).toBe(8 * 3_600_000); // 9-13 + 14-18
    expect(s.pauseMs).toBe(3_600_000);
    expect(s.pendingCount).toBe(1);
  });

  it("mês sem registos → zero em tudo (resposta clara vem do handler)", () => {
    const s = summarizeMonth([], 0, TZ);
    expect(s.days).toBe(0);
    expect(s.entriesCount).toBe(0);
  });
});

describe("rate limit — 5 por dia", () => {
  it("abaixo de 5 passa; no limite bloqueia", async () => {
    const count = vi.fn(() => Promise.resolve(4));
    const prisma = prismaWith({ pontoRegistosToken: { count } });
    expect(await registosRateOk(prisma, "u")).toBe(true);

    const countFull = vi.fn(() => Promise.resolve(5));
    const prismaFull = prismaWith({ pontoRegistosToken: { count: countFull } });
    expect(await registosRateOk(prismaFull, "u")).toBe(false);
  });
});

describe("consumeRegistosToken — uso único e validade 24 h", () => {
  const plaintext = "token-plain";
  const hash = createHash("sha256").update(plaintext).digest("hex");

  function tokenRow(over: Record<string, unknown>) {
    return {
      expiresAt: new Date(Date.now() + 60_000),
      id: "t1",
      month: "2026-11",
      tokenHash: hash,
      usedAt: null,
      userId: "user-A",
      ...over,
    };
  }

  it("token válido → devolve dono e mês, marcando o uso de forma atómica", async () => {
    const findUnique = vi.fn(() => Promise.resolve(tokenRow({})));
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const prisma = prismaWith({
      pontoRegistosToken: { findUnique, updateMany },
    });

    const out = await consumeRegistosToken(prisma, plaintext);
    expect(out).toEqual({ month: "2026-11", userId: "user-A" });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1", usedAt: null } })
    );
  });

  it("já usado → null (só funciona uma vez)", async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(tokenRow({ usedAt: new Date() }))
    );
    const prisma = prismaWith({
      pontoRegistosToken: { findUnique, updateMany: vi.fn() },
    });
    expect(await consumeRegistosToken(prisma, plaintext)).toBeNull();
  });

  it("expirado → null (o link expira)", async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(tokenRow({ expiresAt: new Date(Date.now() - 1000) }))
    );
    const prisma = prismaWith({
      pontoRegistosToken: { findUnique, updateMany: vi.fn() },
    });
    expect(await consumeRegistosToken(prisma, plaintext)).toBeNull();
  });

  it("token desconhecido → null (número desconhecido nunca tem token)", async () => {
    const prisma = prismaWith({});
    expect(await consumeRegistosToken(prisma, "nao-existe")).toBeNull();
  });

  it("corrida de consumo: updateMany count 0 → null", async () => {
    const findUnique = vi.fn(() => Promise.resolve(tokenRow({})));
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const prisma = prismaWith({
      pontoRegistosToken: { findUnique, updateMany },
    });
    expect(await consumeRegistosToken(prisma, plaintext)).toBeNull();
  });
});
