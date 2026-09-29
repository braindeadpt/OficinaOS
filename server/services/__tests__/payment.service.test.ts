import { describe, expect, it, vi } from "vitest";
import { add, computeJobBalance, remove } from "../payment.service.js";

function makePrisma() {
  const auditCreate = vi.fn().mockResolvedValue({});
  const paymentCreate = vi.fn().mockResolvedValue({
    id: "pay-1",
    jobId: "job-1",
    method: "CASH",
    amount: 1000,
  });
  const paymentDelete = vi.fn().mockResolvedValue({});
  const jobUpdate = vi.fn().mockResolvedValue({});
  return {
    auditCreate,
    paymentCreate,
    paymentDelete,
    jobUpdate,
    job: { findUnique: vi.fn(), update: jobUpdate },
    payment: {
      create: paymentCreate,
      delete: paymentDelete,
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "job-1" }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        // The transaction re-reads the balance under the FOR UPDATE lock, so
        // it needs the same aggregates the outer pre-check used.
        job: {
          findUnique: vi.fn().mockResolvedValue(activeJob),
          update: jobUpdate,
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "job-1" }]),
        auditLog: { create: auditCreate },
        payment: { create: paymentCreate, delete: paymentDelete },
      })
    ),
  } as unknown as any;
}

const activeJob = {
  id: "job-1",
  status: "IN_REPAIR",
  depositAmount: { toNumber: () => 500 },
  payments: [{ amount: { toNumber: () => 1000 } }],
  partsUsed: [{ totalCost: { toNumber: () => 3000 } }],
  repairs: [{ price: { toNumber: () => 2000 } }],
};

describe("computeJobBalance", () => {
  it("computes parts + repairs - deposit - payments", () => {
    const { balanceDue, paidTotal } = computeJobBalance(activeJob);
    expect(paidTotal).toBe(1000);
    // 3000 + 2000 - 500 - 1000 = 3500
    expect(balanceDue).toBe(3500);
  });

  it("floors negative balances at zero", () => {
    const overpaid = {
      ...activeJob,
      payments: [{ amount: { toNumber: () => 10_000 } }],
    };
    const { balanceDue } = computeJobBalance(overpaid);
    expect(balanceDue).toBe(0);
  });

  it("treats missing deposit as zero", () => {
    const { balanceDue } = computeJobBalance({
      ...activeJob,
      depositAmount: null,
      payments: [],
    });
    expect(balanceDue).toBe(5000);
  });
});

describe("add payment", () => {
  it("creates a payment and writes an audit log", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue(activeJob);

    const result = await add(
      prisma,
      "job-1",
      { amount: 1000, method: "CASH" },
      "user-1"
    );

    expect(result).toMatchObject({ id: "pay-1" });
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 1000,
        method: "CASH",
        job: { connect: { id: "job-1" } },
      }),
    });
    expect(prisma.auditCreate).toHaveBeenCalled();
  });

  it("allows full payment up to the exact balance", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue(activeJob);

    const result = await add(
      prisma,
      "job-1",
      { amount: 3500, method: "CARD" },
      "user-1"
    );
    expect(result).toMatchObject({ id: "pay-1" });
  });

  it("rejects a payment above the balance due", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue(activeJob);

    const result = await add(
      prisma,
      "job-1",
      { amount: 3500.01, method: "CARD" },
      "user-1"
    );
    expect(result).toMatchObject({
      error: "PAYMENT_EXCEEDS_BALANCE",
      balanceDue: 3500,
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("returns null for an unknown job", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue(null);

    const result = await add(
      prisma,
      "nope",
      { amount: 10, method: "CASH" },
      "user-1"
    );
    expect(result).toBeNull();
  });

  it("blocks payments on cancelled jobs", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue({
      ...activeJob,
      status: "CANCELLED",
    });

    const result = await add(
      prisma,
      "job-1",
      { amount: 10, method: "CASH" },
      "user-1"
    );
    expect(result).toMatchObject({ error: "JOB_IN_TERMINAL_STATUS" });
  });

  it("blocks payments on returned jobs", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue({
      ...activeJob,
      status: "RETURNED",
    });

    const result = await add(
      prisma,
      "job-1",
      { amount: 10, method: "CASH" },
      "user-1"
    );
    expect(result).toMatchObject({ error: "JOB_IN_TERMINAL_STATUS" });
  });

  it("allows payments on delivered jobs (pay on pickup)", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue({
      ...activeJob,
      status: "DELIVERED",
    });

    const result = await add(
      prisma,
      "job-1",
      { amount: 100, method: "CASH" },
      "user-1"
    );
    expect(result).toMatchObject({ id: "pay-1" });
  });

  it("revalidates the balance inside the transaction, after the row lock", async () => {
    // Regression: the balance was only checked before the transaction, so two
    // concurrent payments could both validate against the same stale figure
    // and overpay the job.
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue(activeJob);
    // The locked re-read sees a payment that landed in the meantime, leaving
    // less balance than the pre-transaction check believed.
    const freshJob = {
      ...activeJob,
      payments: [
        { amount: { toNumber: () => 1000 } },
        { amount: { toNumber: () => 3000 } },
      ],
    };
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ id: "job-1" }]),
          job: { findUnique: vi.fn().mockResolvedValue(freshJob) },
          auditLog: { create: prisma.auditCreate },
          payment: { create: prisma.paymentCreate },
        })
    );

    const result = await add(
      prisma,
      "job-1",
      { amount: 1000, method: "CASH" },
      "user-1"
    );

    // 3500 due - 3000 seen under the lock leaves 500 < 1000 requested.
    expect(result).toMatchObject({
      error: "PAYMENT_EXCEEDS_BALANCE",
      balanceDue: 500,
    });
    expect(prisma.paymentCreate).not.toHaveBeenCalled();
  });

  it("locks the job row before re-reading the balance", async () => {
    const prisma = makePrisma();
    prisma.job.findUnique.mockResolvedValue(activeJob);
    // Capture the tx the service actually receives.
    const txHolder: { current?: Record<string, unknown> } = {};
    prisma.$transaction.mockImplementation(
      (fn: (t: Record<string, unknown>) => unknown) => {
        const captured = {
          $queryRaw: vi.fn().mockResolvedValue([{ id: "job-1" }]),
          job: { findUnique: vi.fn().mockResolvedValue(activeJob) },
          auditLog: { create: prisma.auditCreate },
          payment: { create: prisma.paymentCreate },
        };
        txHolder.current = captured;
        return Promise.resolve(fn(captured));
      }
    );

    await add(prisma, "job-1", { amount: 500, method: "CASH" }, "user-1");

    const tx = txHolder.current;
    const queryRaw = tx?.$queryRaw as ReturnType<typeof vi.fn> | undefined;
    const call = queryRaw?.mock.calls[0];
    expect(call?.[0].join("?")).toContain("FOR UPDATE");
  });
});

describe("remove payment", () => {
  it("deletes the payment and writes an audit log", async () => {
    const prisma = makePrisma();
    prisma.payment.findUnique.mockResolvedValue({
      id: "pay-1",
      method: "CASH",
      amount: { toNumber: () => 1000 },
      job: { id: "job-1", status: "DONE" },
    });

    const result = await remove(prisma, "job-1", "pay-1", "user-1");
    expect(result).toBe(true);
    expect(prisma.paymentDelete).toHaveBeenCalledWith({
      where: { id: "pay-1" },
    });
    expect(prisma.auditCreate).toHaveBeenCalled();
  });

  it("allows removal on delivered jobs (corrections)", async () => {
    const prisma = makePrisma();
    prisma.payment.findUnique.mockResolvedValue({
      id: "pay-1",
      method: "CARD",
      amount: { toNumber: () => 500 },
      job: { id: "job-1", status: "DELIVERED" },
    });

    const result = await remove(prisma, "job-1", "pay-1", "user-1");
    expect(result).toBe(true);
  });

  it("blocks removal on cancelled jobs", async () => {
    const prisma = makePrisma();
    prisma.payment.findUnique.mockResolvedValue({
      id: "pay-1",
      method: "CASH",
      amount: { toNumber: () => 100 },
      job: { id: "job-1", status: "CANCELLED" },
    });

    const result = await remove(prisma, "job-1", "pay-1", "user-1");
    expect(result).toMatchObject({ error: "JOB_IN_TERMINAL_STATUS" });
    expect(prisma.paymentDelete).not.toHaveBeenCalled();
  });

  it("returns PAYMENT_NOT_FOUND for unknown payment", async () => {
    const prisma = makePrisma();
    prisma.payment.findUnique.mockResolvedValue(null);

    const result = await remove(prisma, "job-1", "nope", "user-1");
    expect(result).toMatchObject({ error: "PAYMENT_NOT_FOUND" });
  });

  it("returns PAYMENT_NOT_FOUND when payment belongs to another job", async () => {
    const prisma = makePrisma();
    prisma.payment.findUnique.mockResolvedValue({
      id: "pay-1",
      method: "CASH",
      amount: { toNumber: () => 100 },
      job: { id: "other-job", status: "DONE" },
    });

    const result = await remove(prisma, "job-1", "pay-1", "user-1");
    expect(result).toMatchObject({ error: "PAYMENT_NOT_FOUND" });
  });
});
