import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../repositories/types.js";
import {
  listPontoInfoDeliveries,
  upsertPontoInfoDelivery,
} from "../ponto-info.service.js";

function prismaFake() {
  const upsert = vi.fn((args: { create: object; update: object }) =>
    Promise.resolve({
      ...args.create,
      updatedAt: new Date("2026-01-10T12:00:00.000Z"),
    })
  );
  return {
    prisma: {
      pontoInfoDelivery: { upsert },
      user: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              id: "u1",
              isActive: true,
              name: "Ana",
              pontoEnabled: true,
              pontoInfoDelivery: null,
              username: "ana",
            },
            {
              id: "u2",
              isActive: true,
              name: "Bruno",
              pontoEnabled: true,
              pontoInfoDelivery: {
                deliveredAt: new Date("2026-01-05T00:00:00.000Z"),
                registeredById: "owner",
                registeredByName: "Dono",
                signed: true,
                updatedAt: new Date("2026-01-05T10:00:00.000Z"),
              },
              username: "bruno",
            },
            {
              id: "u3",
              isActive: false,
              name: "Carla",
              pontoEnabled: true,
              pontoInfoDelivery: null,
              username: "carla",
            },
          ])
        ),
        findUnique: vi.fn((args: { where: { id: string } }) =>
          Promise.resolve(
            args.where.id === "owner"
              ? { id: "owner", name: "Dono", username: "dono" }
              : { id: args.where.id, pontoEnabled: true }
          )
        ),
      },
    } as unknown as DbClient,
    upsert,
  };
}

describe("registo de entrega da folha de informação do ponto", () => {
  it("conta só trabalhadores ativos do ponto sem entrega no aviso", async () => {
    const { prisma } = prismaFake();
    const out = await listPontoInfoDeliveries(prisma);

    expect(out.rows).toHaveLength(3);
    // Carla está inativa, logo só Ana conta para o aviso.
    expect(out.missingActiveCount).toBe(1);
    expect(out.rows[1]?.delivery).toMatchObject({
      deliveredAt: "2026-01-05",
      registeredByName: "Dono",
      signed: true,
    });
  });

  it("regista data, assinatura e snapshot de quem registou", async () => {
    const { prisma, upsert } = prismaFake();
    const out = await upsertPontoInfoDelivery(prisma, {
      actorId: "owner",
      deliveredAt: "2026-01-08",
      tz: "Europe/Lisbon",
      signed: false,
      userId: "u1",
    });

    expect(upsert).toHaveBeenCalledOnce();
    const args = upsert.mock.calls[0]?.[0] as {
      create: {
        deliveredAt: Date;
        registeredById: string;
        registeredByName: string;
        signed: boolean;
      };
    };
    expect(args.create).toMatchObject({
      registeredById: "owner",
      registeredByName: "Dono",
      signed: false,
    });
    expect(args.create.deliveredAt.toISOString()).toBe(
      "2026-01-08T00:00:00.000Z"
    );
    expect(out).toMatchObject({
      deliveredAt: "2026-01-08",
      registeredByName: "Dono",
      signed: false,
    });
  });

  it("recusa data de entrega no futuro (dia da loja)", async () => {
    // Relógio fixo: sem fake timers o "amanhã" calculado em UTC podia já
    // ser hoje na loja perto da meia-noite e o teste falhava por acaso.
    vi.useFakeTimers();
    try {
      // 23:30 UTC de 10 jan — em Lisboa (inverno, UTC+0) ainda é dia 10;
      // amanhã é 11 em qualquer cenário.
      vi.setSystemTime(new Date("2026-01-10T23:30:00.000Z"));
      const { prisma, upsert } = prismaFake();

      await expect(
        upsertPontoInfoDelivery(prisma, {
          actorId: "owner",
          deliveredAt: "2026-01-11",
          signed: false,
          tz: "Europe/Lisbon",
          userId: "u1",
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(upsert).not.toHaveBeenCalled();

      // o próprio dia continua a ser aceite perto da meia-noite
      await upsertPontoInfoDelivery(prisma, {
        actorId: "owner",
        deliveredAt: "2026-01-10",
        signed: false,
        tz: "Europe/Lisbon",
        userId: "u1",
      });
      expect(upsert).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
