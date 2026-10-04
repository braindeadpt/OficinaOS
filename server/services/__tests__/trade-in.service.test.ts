import { AppError } from "@shared/errors/app-error.js";
import { describe, expect, it, vi } from "vitest";
import {
  createTradeIn,
  getTradeIn,
  listTradeIns,
  transitionTradeIn,
  updateTradeIn,
} from "../trade-in.service.js";

const CODE_RE = /^RET-\d{4}-000007$/;

function makePrisma(overrides: Record<string, unknown> = {}) {
  const tradeIn = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "ti-1",
      ...data,
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "ti-1",
      ...data,
    })),
    ...((overrides.tradeIn as object) ?? {}),
  };
  return {
    tradeIn,
    $queryRaw: vi.fn().mockResolvedValue([{ lastSeq: 7 }]),
    customer: {
      findUnique: vi.fn().mockResolvedValue({ id: "cust-1" }),
      ...(overrides.customer as object),
    },
  } as unknown as any;
}

const baseInput = {
  condition: "GOOD" as const,
  customerId: "cust-1",
  deviceBrand: "Apple",
  deviceModel: "iPhone 12",
  paymentMethod: "CASH" as const,
  purchasePrice: 150,
  sellerIdNumber: "12345678",
  sellerIdType: "CC" as const,
};

describe("listTradeIns", () => {
  it("applies pagination offset to the query", async () => {
    const prisma = makePrisma();
    await listTradeIns(prisma, { page: 3, limit: 10 });
    expect(prisma.tradeIn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it("clamps limit and filters by status", async () => {
    const prisma = makePrisma();
    const result = await listTradeIns(prisma, {
      limit: 999,
      status: "OFFERED",
    });
    expect(result.limit).toBe(100);
    expect(prisma.tradeIn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "OFFERED" } })
    );
  });
});

describe("getTradeIn", () => {
  it("throws TRADE_IN_NOT_FOUND when missing", async () => {
    const prisma = makePrisma();
    await expect(getTradeIn(prisma, "nope")).rejects.toThrow(AppError);
    await expect(getTradeIn(prisma, "nope")).rejects.toMatchObject({
      code: "TRADE_IN_NOT_FOUND",
    });
  });
});

describe("createTradeIn", () => {
  it("rejects an unknown customer", async () => {
    const prisma = makePrisma({
      customer: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      createTradeIn(prisma, baseInput, "user-1")
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });

  it("creates with the generated code and OFFERED defaults", async () => {
    const prisma = makePrisma();
    const created = await createTradeIn(prisma, baseInput, "user-1");
    expect(prisma.tradeIn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: expect.stringMatching(CODE_RE),
          createdById: "user-1",
          customerId: "cust-1",
        }),
      })
    );
    expect(created.customerId).toBe("cust-1");
  });
});

describe("updateTradeIn", () => {
  it("allows edits while OFFERED", async () => {
    const prisma = makePrisma({
      tradeIn: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "ti-1", status: "OFFERED" }),
      },
    });
    await updateTradeIn(prisma, "ti-1", { purchasePrice: 200 });
    expect(prisma.tradeIn.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ti-1" } })
    );
  });

  it("rejects edits once the offer was decided", async () => {
    const prisma = makePrisma({
      tradeIn: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "ti-1", status: "PURCHASED" }),
      },
    });
    await expect(
      updateTradeIn(prisma, "ti-1", { purchasePrice: 200 })
    ).rejects.toMatchObject({ code: "TRADE_IN_INVALID_STATE" });
  });
});

describe("transitionTradeIn", () => {
  function prismaWith(status: string, signatureDataUrl: string | null = "sig") {
    return makePrisma({
      tradeIn: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "ti-1", status, signatureDataUrl }),
      },
    });
  }

  it("moves OFFERED to PURCHASED when the seller signature exists", async () => {
    const prisma = prismaWith("OFFERED", "data:image/png;base64,x");
    await transitionTradeIn(prisma, "ti-1", "PURCHASED");
    expect(prisma.tradeIn.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PURCHASED" } })
    );
  });

  it("requires the seller signature before PURCHASED", async () => {
    const prisma = prismaWith("OFFERED", null);
    await expect(
      transitionTradeIn(prisma, "ti-1", "PURCHASED")
    ).rejects.toMatchObject({ code: "TRADE_IN_SIGNATURE_REQUIRED" });
  });

  it("rejects skipping straight to SOLD", async () => {
    const prisma = prismaWith("OFFERED");
    await expect(
      transitionTradeIn(prisma, "ti-1", "SOLD")
    ).rejects.toMatchObject({ code: "TRADE_IN_INVALID_STATE" });
  });

  it("moves PURCHASED to SOLD and blocks further transitions", async () => {
    const purchased = prismaWith("PURCHASED");
    await transitionTradeIn(purchased, "ti-1", "SOLD");
    expect(purchased.tradeIn.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SOLD" } })
    );

    const sold = prismaWith("SOLD");
    await expect(
      transitionTradeIn(sold, "ti-1", "CANCELLED")
    ).rejects.toMatchObject({ code: "TRADE_IN_INVALID_STATE" });
  });

  it("cancels an open offer", async () => {
    const prisma = prismaWith("OFFERED");
    await transitionTradeIn(prisma, "ti-1", "CANCELLED");
    expect(prisma.tradeIn.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } })
    );
  });
});
