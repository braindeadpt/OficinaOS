import { describe, expect, it, vi } from "vitest";
import {
  clearPaymentOnDelivery,
  setPaymentOnDelivery,
  settlePaymentOnDelivery,
} from "../payment.service.js";

function makePrisma() {
  const auditCreate = vi.fn().mockResolvedValue({});
  const paymentCreate = vi.fn().mockResolvedValue({ id: "pay-auto-1" });
  const jobUpdate = vi.fn().mockResolvedValue({});
  return {
    auditCreate,
    jobUpdate,
    paymentCreate,
    job: { findUnique: vi.fn(), update: jobUpdate },
    payment: { create: paymentCreate },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        auditLog: { create: auditCreate },
        // settlePaymentOnDelivery locks and re-reads the job row
        // in-transaction, so the tx needs the full job model.
        job: {
          findUnique: vi.fn().mockResolvedValue(baseJob),
          update: jobUpdate,
        },
        payment: { create: paymentCreate },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "job-1" }]),
      })
    ),
  } as unknown as any;
}

// parts 3000 + repairs 2000 - deposit 500 - payments 1000 = 3500 due
const baseJob = {
  id: "job-1",
  status: "IN_REPAIR",
  depositAmount: { toNumber: () => 500 },
  paymentOnDeliveryMethod: null,
  payments: [{ amount: { toNumber: () => 1000 } }],
  partsUsed: [{ totalCost: { toNumber: () => 3000 } }],
  repairs: [{ price: { toNumber: () => 2000 } }],
};

describe("setPaymentOnDelivery", () => {
  it("marks the job and audits the mark", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
    });

    const result = await setPaymentOnDelivery(prisma, "job-1", "CASH", "u1");

    expect(result).toEqual({ balanceDue: 3500, method: "CASH" });
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentOnDeliveryMethod: "CASH" },
      })
    );
    expect(prisma.auditCreate).toHaveBeenCalled();
  });

  it("rejects when job does not exist", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await setPaymentOnDelivery(prisma, "job-1", "CASH", "u1");

    expect(result).toBeNull();
  });

  it("rejects double marking", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      paymentOnDeliveryMethod: "CARD",
    });

    const result = await setPaymentOnDelivery(prisma, "job-1", "CASH", "u1");

    expect(result).toEqual({ error: "PAYMENT_ON_DELIVERY_ALREADY_MARKED" });
  });

  it("rejects when there is nothing due", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      payments: [{ amount: { toNumber: () => 4500 } }],
    });

    const result = await setPaymentOnDelivery(prisma, "job-1", "CASH", "u1");

    expect(result).toEqual({ error: "NO_PAYMENT_DUE" });
  });

  it("rejects marking a cancelled job", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      status: "CANCELLED",
    });

    const result = await setPaymentOnDelivery(prisma, "job-1", "CASH", "u1");

    expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
  });
});

describe("clearPaymentOnDelivery", () => {
  it("clears the mark", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      paymentOnDeliveryMethod: "CASH",
    });

    const result = await clearPaymentOnDelivery(prisma, "job-1", "u1");

    expect(result).toBe(true);
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentOnDeliveryMethod: null },
      })
    );
  });

  it("errors when the job was not marked", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
    });

    const result = await clearPaymentOnDelivery(prisma, "job-1", "u1");

    expect(result).toEqual({ error: "PAYMENT_ON_DELIVERY_NOT_MARKED" });
  });
});

describe("settlePaymentOnDelivery", () => {
  it("records the balance as a payment and clears the flag on DELIVERED", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      status: "DELIVERED",
      paymentOnDeliveryMethod: "CASH",
    });

    await settlePaymentOnDelivery(prisma, "job-1", "u1");

    expect(prisma.paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 3500, method: "CASH" }),
      })
    );
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentOnDeliveryMethod: null },
      })
    );
    expect(prisma.auditCreate).toHaveBeenCalled();
  });

  it("does nothing when the job was not marked", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      status: "DELIVERED",
    });

    await settlePaymentOnDelivery(prisma, "job-1", "u1");

    expect(prisma.paymentCreate).not.toHaveBeenCalled();
  });

  it("does nothing when the job is not yet delivered", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      status: "DONE",
      paymentOnDeliveryMethod: "CASH",
    });

    await settlePaymentOnDelivery(prisma, "job-1", "u1");

    expect(prisma.paymentCreate).not.toHaveBeenCalled();
  });

  it("only clears the flag when balance reaches zero before delivery", async () => {
    const prisma = makePrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      payments: [{ amount: { toNumber: () => 4500 } }],
      status: "DELIVERED",
      paymentOnDeliveryMethod: "CASH",
    });

    await settlePaymentOnDelivery(prisma, "job-1", "u1");

    expect(prisma.paymentCreate).not.toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentOnDeliveryMethod: null },
      })
    );
  });
});
