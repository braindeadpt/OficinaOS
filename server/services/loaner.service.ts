import { AuditAction, type PrismaClient } from "@generated/client";
import { JobStatus } from "@shared/constants/job-statuses";
import { AppError } from "@shared/errors/app-error.js";
import { describeLoanerDevice } from "@shared/loaner-description.js";
import type {
  CreateLoanerDeviceInput,
  UpdateLoanerDeviceInput,
} from "@shared/schemas/loaner.schema.js";
import type { DbClient } from "../repositories/types.js";
import { createAuditLog } from "./audit.service.js";

// A unit is "out" while a non-CANCELLED job references it without a return
// stamp. DELIVERED with loanerReturnedAt NULL stays out on purpose — the
// customer kept the unit past pickup and it must keep showing as lent.
const OPEN_LOAN_WHERE = {
  loanerReturnedAt: null,
  status: { not: JobStatus.CANCELLED },
} as const;

const OPEN_LOAN_SELECT = {
  createdAt: true,
  customer: { select: { name: true, phone: true } },
  estimatedDate: true,
  id: true,
  jobCode: true,
  status: true,
} as const;

export type LoanerStatus = "available" | "out" | "retired";

/**
 * Assignability check shared by job create/update — runs inside the caller's
 * transaction after locking the unit row, so two intakes can never hand out
 * the same device at once.
 */
export async function assertLoanerAssignable(
  tx: DbClient,
  deviceId: string,
  excludeJobId?: string
) {
  const device = await tx.loanerDevice.findUnique({
    select: { active: true, id: true },
    where: { id: deviceId },
  });
  if (!device) {
    throw new AppError("LOANER_DEVICE_NOT_FOUND");
  }
  if (!device.active) {
    throw new AppError("LOANER_DEVICE_INACTIVE");
  }
  const openLoan = await tx.job.findFirst({
    select: { id: true, jobCode: true },
    where: {
      ...OPEN_LOAN_WHERE,
      id: excludeJobId ? { not: excludeJobId } : undefined,
      loanerDeviceId: deviceId,
    },
  });
  if (openLoan) {
    throw new AppError("LOANER_DEVICE_UNAVAILABLE", {
      jobCode: openLoan.jobCode,
    });
  }
}

/**
 * Intake-side fleet checkout — locks the unit row inside the caller's
 * transaction so simultaneous intakes can't hand the same unit out twice,
 * verifies assignability, and supplies the printable note when the form
 * left it empty.
 */
export async function checkoutLoanerDevice(
  tx: DbClient,
  deviceId: string,
  loanerNote: string | null | undefined
): Promise<{ connect: { connect: { id: string } }; note: string }> {
  await tx.$queryRaw`SELECT "id" FROM "loaner_devices" WHERE "id" = ${deviceId} FOR UPDATE`;
  await assertLoanerAssignable(tx, deviceId);
  const device = await tx.loanerDevice.findUniqueOrThrow({
    where: { id: deviceId },
  });
  return {
    connect: { connect: { id: device.id } },
    note: loanerNote?.trim() ? loanerNote : describeLoanerDevice(device),
  };
}

export async function listLoanerDevices(prisma: PrismaClient) {
  const devices = await prisma.loanerDevice.findMany({
    include: {
      jobs: {
        select: OPEN_LOAN_SELECT,
        take: 1,
        where: OPEN_LOAN_WHERE,
      },
    },
    orderBy: { label: "asc" },
  });
  return devices.map((device) => {
    const { jobs, ...rest } = device;
    const openLoan = jobs[0] ?? null;
    let status: LoanerStatus = "retired";
    if (openLoan) {
      status = "out";
    } else if (device.active) {
      status = "available";
    }
    return { ...rest, currentLoan: openLoan, status };
  });
}

export async function createLoanerDevice(
  prisma: PrismaClient,
  input: CreateLoanerDeviceInput
) {
  return await prisma.loanerDevice.create({
    data: {
      brand: input.brand || null,
      imei: input.imei || null,
      label: input.label,
      model: input.model || null,
      notes: input.notes || null,
    },
  });
}

export async function updateLoanerDevice(
  prisma: PrismaClient,
  id: string,
  input: UpdateLoanerDeviceInput
) {
  const existing = await prisma.loanerDevice.findUnique({
    select: { id: true },
    where: { id },
  });
  if (!existing) {
    throw new AppError("LOANER_DEVICE_NOT_FOUND");
  }
  // Identity fields are frozen while the unit is out — changing them would
  // reprint the responsibility term with equipment the customer never
  // received. notes/active stay editable; retire the unit or wait for the
  // return before correcting its identity.
  const identityChange =
    input.label !== undefined ||
    input.brand !== undefined ||
    input.model !== undefined ||
    input.imei !== undefined;
  if (identityChange) {
    const openLoan = await prisma.job.findFirst({
      select: { id: true },
      where: { ...OPEN_LOAN_WHERE, loanerDeviceId: id },
    });
    if (openLoan) {
      throw new AppError("LOANER_UNIT_ON_LOAN");
    }
  }
  // Keep the columns honest: "" means "cleared", same as create's null.
  const emptyToNull = (v: string | null | undefined) =>
    v === undefined ? undefined : v?.trim() || null;
  return await prisma.loanerDevice.update({
    data: {
      active: input.active,
      brand: emptyToNull(input.brand),
      imei: emptyToNull(input.imei),
      label: input.label,
      model: emptyToNull(input.model),
      notes: emptyToNull(input.notes),
    },
    where: { id },
  });
}

/**
 * Records a unit physically coming back — finds the open loan and stamps it.
 * Stragglers (customer kept the unit past delivery) land here too.
 */
export async function markLoanerReturned(
  prisma: PrismaClient,
  deviceId: string,
  userId: string
) {
  return await prisma.$transaction(async (tx) => {
    // Same unit-row serialization as intake/reassignment — the open loan
    // resolved below can't be swapped to another unit mid-transaction.
    await tx.$queryRaw`SELECT "id" FROM "loaner_devices" WHERE "id" = ${deviceId} FOR UPDATE`;
    const job = await tx.job.findFirst({
      select: { id: true, jobCode: true },
      where: { ...OPEN_LOAN_WHERE, loanerDeviceId: deviceId },
    });
    if (!job) {
      throw new AppError("LOANER_NOT_ACTIVE");
    }
    // Conditional update: the stamp lands only if the row is still THIS loan
    // (same unit, unreturned, not cancelled). A concurrent reassignment or
    // double return yields count 0 — never stamps the replacement unit.
    const res = await tx.job.updateMany({
      data: { loanerReturnedAt: new Date() },
      where: { id: job.id, ...OPEN_LOAN_WHERE, loanerDeviceId: deviceId },
    });
    if (res.count === 0) {
      throw new AppError("LOANER_NOT_ACTIVE");
    }
    await createAuditLog(tx, {
      action: AuditAction.LOANER_RETURNED,
      jobId: job.id,
      toValue: deviceId,
      userId,
    });
    return { jobId: job.id, jobCode: job.jobCode };
  });
}
