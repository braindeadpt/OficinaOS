import { AuditAction } from "@generated/client";
import { isAppError } from "@shared/errors/app-error.js";
import { describeLoanerDevice } from "@shared/loaner-description.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertLoanerAssignable,
  listLoanerDevices,
  markLoanerReturned,
  updateLoanerDevice,
} from "../services/loaner.service.js";

const loanerDeviceFindMany = vi.fn();
const loanerDeviceFindUnique = vi.fn();
const loanerDeviceUpdate = vi.fn();
const jobFindFirst = vi.fn();
const jobUpdate = vi.fn();
const jobUpdateMany = vi.fn();
const auditLogCreate = vi.fn();
const queryRaw = vi.fn();

const tx = {
  job: {
    findFirst: jobFindFirst,
    update: jobUpdate,
    updateMany: jobUpdateMany,
  },
  loanerDevice: {
    findUnique: loanerDeviceFindUnique,
    update: loanerDeviceUpdate,
  },
  auditLog: { create: auditLogCreate },
  $queryRaw: queryRaw,
};

const prisma = {
  ...tx,
  loanerDevice: { ...tx.loanerDevice, findMany: loanerDeviceFindMany },
  $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
} as unknown as Parameters<typeof listLoanerDevices>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("describeLoanerDevice", () => {
  it("joins label, spec and IMEI", () => {
    expect(
      describeLoanerDevice({
        brand: "Nokia",
        imei: "3530",
        label: "Loja #1",
        model: "105",
      })
    ).toBe("Loja #1 (Nokia 105) · IMEI 3530");
  });

  it("falls back to the label alone", () => {
    expect(describeLoanerDevice({ label: "Loja #1" })).toBe("Loja #1");
  });
});

describe("listLoanerDevices", () => {
  it("derives available / out / retired from the open loan", async () => {
    loanerDeviceFindMany.mockResolvedValue([
      { active: true, id: "d1", jobs: [] },
      {
        active: true,
        id: "d2",
        jobs: [{ id: "j1", jobCode: "R-1", status: "IN_REPAIR" }],
      },
      { active: false, id: "d3", jobs: [] },
    ]);

    const list = await listLoanerDevices(prisma);
    expect(list.map((d) => d.status)).toEqual(["available", "out", "retired"]);
    expect(list[1].currentLoan?.jobCode).toBe("R-1");
    expect(list[0].currentLoan).toBeNull();
  });
});

describe("assertLoanerAssignable", () => {
  it("rejects an unknown unit", async () => {
    loanerDeviceFindUnique.mockResolvedValue(null);
    await expect(
      assertLoanerAssignable(tx as never, "missing")
    ).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_DEVICE_NOT_FOUND"
    );
  });

  it("rejects a retired unit", async () => {
    loanerDeviceFindUnique.mockResolvedValue({ active: false, id: "d1" });
    await expect(assertLoanerAssignable(tx as never, "d1")).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_DEVICE_INACTIVE"
    );
  });

  it("rejects a unit already out on another job", async () => {
    loanerDeviceFindUnique.mockResolvedValue({ active: true, id: "d1" });
    jobFindFirst.mockResolvedValue({ id: "j9", jobCode: "R-9" });
    await expect(
      assertLoanerAssignable(tx as never, "d1", "j1")
    ).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_DEVICE_UNAVAILABLE"
    );
    expect(jobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "j1" },
          loanerDeviceId: "d1",
        }),
      })
    );
  });
});

describe("updateLoanerDevice", () => {
  it("throws NOT_FOUND for a missing unit", async () => {
    loanerDeviceFindUnique.mockResolvedValue(null);
    await expect(
      updateLoanerDevice(prisma, "missing", { label: "x" })
    ).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_DEVICE_NOT_FOUND"
    );
  });

  it("blocks identity edits while the unit is on loan", async () => {
    loanerDeviceFindUnique.mockResolvedValue({ id: "d1" });
    jobFindFirst.mockResolvedValue({ id: "j1" });
    await expect(
      updateLoanerDevice(prisma, "d1", { imei: "123456" })
    ).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_UNIT_ON_LOAN"
    );
    expect(loanerDeviceUpdate).not.toHaveBeenCalled();
  });

  it("allows notes/active edits while the unit is on loan", async () => {
    loanerDeviceFindUnique.mockResolvedValue({ id: "d1" });
    jobFindFirst.mockResolvedValue({ id: "j1" });
    loanerDeviceUpdate.mockResolvedValue({ id: "d1" });
    await updateLoanerDevice(prisma, "d1", { active: false, notes: "x" });
    expect(loanerDeviceUpdate).toHaveBeenCalled();
  });

  it("allows identity edits when the unit is not on loan", async () => {
    loanerDeviceFindUnique.mockResolvedValue({ id: "d1" });
    jobFindFirst.mockResolvedValue(null);
    loanerDeviceUpdate.mockResolvedValue({ id: "d1" });
    await updateLoanerDevice(prisma, "d1", { label: "Loja #2" });
    expect(loanerDeviceUpdate).toHaveBeenCalled();
  });
});

describe("markLoanerReturned", () => {
  it("rejects when no open loan exists", async () => {
    jobFindFirst.mockResolvedValue(null);
    await expect(markLoanerReturned(prisma, "d1", "u1")).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_NOT_ACTIVE"
    );
    expect(jobUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects when the open loan changed under the request", async () => {
    // Concurrent reassignment/double-return: the conditional update matches
    // zero rows, so no stamp lands on the wrong unit and no audit is written.
    jobFindFirst.mockResolvedValue({ id: "j1", jobCode: "R-1" });
    jobUpdateMany.mockResolvedValue({ count: 0 });
    await expect(markLoanerReturned(prisma, "d1", "u1")).rejects.toSatisfy(
      (e) => isAppError(e) && e.code === "LOANER_NOT_ACTIVE"
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("stamps the job with a conditional update and audits the return", async () => {
    jobFindFirst.mockResolvedValue({ id: "j1", jobCode: "R-1" });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    auditLogCreate.mockResolvedValue({});

    const result = await markLoanerReturned(prisma, "d1", "u1");

    expect(result).toEqual({ jobId: "j1", jobCode: "R-1" });
    expect(queryRaw).toHaveBeenCalled();
    expect(jobUpdateMany).toHaveBeenCalledWith({
      data: { loanerReturnedAt: expect.any(Date) },
      where: {
        id: "j1",
        loanerDeviceId: "d1",
        loanerReturnedAt: null,
        status: { not: "CANCELLED" },
      },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.LOANER_RETURNED,
          jobId: "j1",
          toValue: "d1",
          userId: "u1",
        }),
      })
    );
  });
});
