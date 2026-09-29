import {
  CashSessionStatus,
  Prisma,
  type PrismaClient,
} from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeCashSession,
  getSessionForDay,
  reopenCashSession,
} from "../cash-session.service.js";

interface SessionRow {
  cashDivergence: unknown;
  closedAt: Date | null;
  closedBy: { id: string; name: string; username: string } | null;
  countedCash: unknown;
  countedNonCash: unknown;
  countedTotalCollected: unknown;
  day: Date;
  id: string;
  note: string | null;
  openedAt: Date;
  openedBy: { id: string; name: string; username: string };
  reopenCount: number;
  report: unknown;
  signatureDataUrl: string | null;
  status: CashSessionStatus;
  timezone: string;
}

function makeRow(over: Partial<SessionRow> = {}): SessionRow {
  return {
    closedAt: null,
    closedBy: null,
    countedCash: null,
    countedNonCash: null,
    countedTotalCollected: null,
    cashDivergence: null,
    day: new Date("2026-09-29T00:00:00.000Z"),
    id: "cs-1",
    note: null,
    openedAt: new Date("2026-09-29T10:00:00.000Z"),
    openedBy: { id: "u1", name: "Owner", username: "owner" },
    reopenCount: 0,
    report: {},
    signatureDataUrl: null,
    status: CashSessionStatus.OPEN,
    timezone: "UTC",
    ...over,
  };
}

function makePrisma(row: SessionRow | null) {
  return {
    cashSession: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          makeRow({
            day: data.day,
            timezone: data.timezone,
            report: data.report,
          })
        )
      ),
      findUnique: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockImplementation(({ data }) => {
        const d = { ...data };
        if (d.reopenCount && typeof d.reopenCount === "object") {
          d.reopenCount = (row?.reopenCount ?? 0) + d.reopenCount.increment;
        }
        return Promise.resolve(
          makeRow({
            ...row,
            ...d,
            closedBy: d.closedById
              ? { id: d.closedById, name: "Owner", username: "owner" }
              : null,
          })
        );
      }),
    },
  } as unknown as any;
}

const ownerScope = { role: "OWNER", shopTz: "UTC", userId: "u1" } as any;
const NOW = new Date("2026-09-29T15:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSessionForDay", () => {
  it("returns the existing session without creating one", async () => {
    const prisma = makePrisma(makeRow());
    const dto = await getSessionForDay(
      prisma as unknown as PrismaClient,
      ownerScope,
      NOW
    );
    expect(dto.id).toBe("cs-1");
    expect(dto.status).toBe("OPEN");
    expect(prisma.cashSession.create).not.toHaveBeenCalled();
  });

  it("auto-opens a session on first access of the day", async () => {
    const prisma = makePrisma(null);
    const dto = await getSessionForDay(
      prisma as unknown as PrismaClient,
      ownerScope,
      NOW
    );
    expect(dto.status).toBe("OPEN");
    expect(prisma.cashSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          day: new Date("2026-09-29T00:00:00.000Z"),
          openedById: "u1",
          timezone: "UTC",
        }),
      })
    );
  });

  it("falls back to the winner's session on P2002 race", async () => {
    const prisma = makePrisma(null);
    const winner = makeRow({ id: "cs-winner" });
    (prisma.cashSession.create as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("unique constraint", {
          code: "P2002",
          clientVersion: "7.7.0",
        })
      )
      .mockResolvedValueOnce(undefined);
    (prisma.cashSession.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);

    const dto = await getSessionForDay(
      prisma as unknown as PrismaClient,
      ownerScope,
      NOW
    );
    expect(dto.id).toBe("cs-winner");
  });
});

describe("closeCashSession", () => {
  it("freezes the report, records counted cash and divergence", async () => {
    const prisma = makePrisma(makeRow());
    const spy = vi
      .spyOn(await import("../cash-report.service.js"), "computeCashReport")
      .mockResolvedValue({
        byMethod: [],
        byUser: [],
        date: NOW.toISOString(),
        largestPayment: null,
        summary: {
          cashTotal: 112.5,
          paymentCount: 5,
          totalCollected: 300,
          transferTotal: 187.5,
          userCount: 2,
        },
      } as never);

    const dto = await closeCashSession(
      prisma as unknown as PrismaClient,
      ownerScope,
      {
        countedCash: 100.5,
        countedNonCash: 187.5,
        signatureDataUrl: "data:image/png;base64,AAA",
      },
      NOW
    );

    expect(dto.status).toBe("CLOSED");
    expect(dto.counted.cash).toBe(100.5);
    expect(dto.divergence.cash).toBe(-12);
    expect(prisma.cashSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cashDivergence: -12,
          countedCash: 100.5,
          countedNonCash: 187.5,
          closedById: "u1",
          signatureDataUrl: "data:image/png;base64,AAA",
          status: CashSessionStatus.CLOSED,
        }),
      })
    );
    spy.mockRestore();
  });

  it("rejects closing an already closed day", async () => {
    const prisma = makePrisma(makeRow({ status: CashSessionStatus.CLOSED }));
    await expect(
      closeCashSession(
        prisma as unknown as PrismaClient,
        ownerScope,
        { countedCash: 10 },
        NOW
      )
    ).rejects.toMatchObject({ code: "CASH_SESSION_ALREADY_CLOSED" });
  });
});

describe("reopenCashSession", () => {
  it("clears the count and signature, increments reopenCount", async () => {
    const prisma = makePrisma(
      makeRow({
        closedAt: new Date("2026-09-29T18:00:00.000Z"),
        closedBy: { id: "u1", name: "Owner", username: "owner" },
        countedCash: 100,
        cashDivergence: -12.5,
        signatureDataUrl: "data:image/png;base64,AAA",
        status: CashSessionStatus.CLOSED,
      })
    );

    const dto = await reopenCashSession(
      prisma as unknown as PrismaClient,
      ownerScope,
      NOW
    );

    expect(dto.status).toBe("OPEN");
    expect(dto.reopenCount).toBe(1);
    expect(prisma.cashSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cashDivergence: null,
          countedCash: null,
          countedNonCash: null,
          countedTotalCollected: null,
          closedAt: null,
          closedById: null,
          note: null,
          reopenCount: { increment: 1 },
          signatureDataUrl: null,
          status: CashSessionStatus.OPEN,
        }),
      })
    );
  });

  it("rejects reopening a day that is still open", async () => {
    const prisma = makePrisma(makeRow());
    await expect(
      reopenCashSession(prisma as unknown as PrismaClient, ownerScope, NOW)
    ).rejects.toMatchObject({ code: "CASH_SESSION_NOT_CLOSED" });
  });
});
