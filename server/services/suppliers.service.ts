import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  createSupplierRmaSchema,
  createSupplierSchema,
  updateSupplierRmaSchema,
  updateSupplierSchema,
} from "@shared/schemas/supplier.schema";
import type { z } from "zod";

type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
type CreateRmaInput = z.infer<typeof createSupplierRmaSchema>;
type UpdateRmaInput = z.infer<typeof updateSupplierRmaSchema>;

export function listSuppliers(
  prisma: PrismaClient,
  opts: { search?: string; includeInactive?: boolean }
) {
  return prisma.supplier.findMany({
    where: {
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.search
        ? { name: { contains: opts.search, mode: "insensitive" } }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { rmas: true } } },
    take: 500,
  });
}

export function createSupplier(
  prisma: PrismaClient,
  input: CreateSupplierInput
) {
  return prisma.supplier.create({ data: input });
}

export async function updateSupplier(
  prisma: PrismaClient,
  id: string,
  input: UpdateSupplierInput
) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("NOT_FOUND");
  }
  return prisma.supplier.update({ where: { id }, data: input });
}

export function listRmas(
  prisma: PrismaClient,
  opts: { supplierId?: string; status?: string; jobId?: string }
) {
  return prisma.supplierRma.findMany({
    where: {
      ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true } },
      part: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, username: true } },
    },
    take: 500,
  });
}

export async function createRma(
  prisma: PrismaClient,
  input: CreateRmaInput,
  userId: string
) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
  });
  if (!supplier) {
    throw new AppError("NOT_FOUND");
  }
  const { jobCode, ...rmaInput } = input;
  const job = jobCode
    ? await prisma.job.findUnique({ where: { jobCode } })
    : null;
  if (jobCode && !job) {
    throw new AppError("JOB_NOT_FOUND");
  }
  if (input.partId) {
    const part = await prisma.partsCatalog.findUnique({
      where: { id: input.partId },
    });
    if (!part) {
      throw new AppError("NOT_FOUND");
    }
  }
  return prisma.supplierRma.create({
    data: { ...rmaInput, jobId: job?.id, createdById: userId },
    include: {
      supplier: { select: { id: true, name: true } },
      part: { select: { id: true, name: true } },
    },
  });
}

const TERMINAL_RMA_STATUSES = new Set(["RESOLVED", "CANCELLED"]);

export async function updateRma(
  prisma: PrismaClient,
  id: string,
  input: UpdateRmaInput
) {
  const existing = await prisma.supplierRma.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("NOT_FOUND");
  }
  const data: Record<string, unknown> = { ...input };
  if (input.status === "SENT" && !existing.sentAt) {
    data.sentAt = new Date();
  }
  if (
    input.status &&
    TERMINAL_RMA_STATUSES.has(input.status) &&
    !existing.resolvedAt
  ) {
    data.resolvedAt = new Date();
  }
  return prisma.supplierRma.update({
    where: { id },
    data,
    include: {
      supplier: { select: { id: true, name: true } },
      part: { select: { id: true, name: true } },
    },
  });
}
