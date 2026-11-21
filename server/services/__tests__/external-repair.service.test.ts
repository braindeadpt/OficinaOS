import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import {
  cancelExternalRepair,
  createExternalRepair,
  listExternalRepairs,
  returnExternalRepair,
} from "../external-repair.service";

function mockPrisma(
  overrides: Partial<Record<keyof PrismaClient, unknown>> = {}
) {
  return {
    job: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn() },
    externalRepair: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

const createData = {
  supplierId: "sup-1",
  kind: "REPAIRER" as const,
  reference: "OR-123",
};

describe("createExternalRepair", () => {
  it("throws JOB_NOT_FOUND when job does not exist", async () => {
    const prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      createExternalRepair(prisma, "job-1", createData, "user-1")
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("rejects inactive or missing supplier", async () => {
    const prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
    });
    (prisma.supplier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sup-1",
      isActive: false,
    });
    await expect(
      createExternalRepair(prisma, "job-1", createData, "user-1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when an open SENT repair already exists", async () => {
    const prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
    });
    (prisma.supplier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sup-1",
      isActive: true,
    });
    (
      prisma.externalRepair.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "er-1", status: "SENT" });
    await expect(
      createExternalRepair(prisma, "job-1", createData, "user-1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates the repair with supplier, kind and creator", async () => {
    const prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
    });
    (prisma.supplier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sup-1",
      isActive: true,
    });
    (
      prisma.externalRepair.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const created = { id: "er-1", status: "SENT" };
    (
      prisma.externalRepair.create as ReturnType<typeof vi.fn>
    ).mockResolvedValue(created);
    const result = await createExternalRepair(
      prisma,
      "job-1",
      createData,
      "user-1"
    );
    expect(result).toBe(created);
    expect(prisma.externalRepair.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: "job-1",
          supplierId: "sup-1",
          kind: "REPAIRER",
          reference: "OR-123",
          createdById: "user-1",
        }),
      })
    );
  });

  it("rejects sending a delivered or cancelled job", async () => {
    const prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "DELIVERED",
    });
    await expect(
      createExternalRepair(prisma, "job-1", createData, "user-1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps the open-repair unique violation to VALIDATION_ERROR", async () => {
    const prisma = mockPrisma();
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      status: "IN_REPAIR",
    });
    (prisma.supplier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sup-1",
      isActive: true,
    });
    (
      prisma.externalRepair.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    (
      prisma.externalRepair.create as ReturnType<typeof vi.fn>
    ).mockRejectedValue({ code: "P2002" });
    await expect(
      createExternalRepair(prisma, "job-1", createData, "user-1")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("listExternalRepairs", () => {
  it("returns repairs for the job ordered by sentAt desc", async () => {
    const prisma = mockPrisma();
    const rows = [{ id: "er-1" }];
    (
      prisma.externalRepair.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(rows);
    const result = await listExternalRepairs(prisma, "job-1");
    expect(result).toBe(rows);
    expect(prisma.externalRepair.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "job-1" },
        orderBy: { sentAt: "desc" },
      })
    );
  });
});

describe("returnExternalRepair", () => {
  it("throws NOT_FOUND when repair does not exist", async () => {
    const prisma = mockPrisma();
    (
      prisma.externalRepair.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    await expect(
      returnExternalRepair(prisma, "er-1", {})
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects returning a repair that is no longer SENT", async () => {
    const prisma = mockPrisma();
    (
      prisma.externalRepair.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "er-1", notes: null });
    (
      prisma.externalRepair.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 0 });
    await expect(
      returnExternalRepair(prisma, "er-1", { costFinal: 45 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.externalRepair.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "er-1", status: "SENT" },
      })
    );
  });

  it("marks RETURNED with costFinal and returnedAt", async () => {
    const prisma = mockPrisma();
    (
      prisma.externalRepair.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "er-1", notes: null });
    (
      prisma.externalRepair.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 1 });
    const updated = { id: "er-1", status: "RETURNED" };
    (
      prisma.externalRepair.findUniqueOrThrow as ReturnType<typeof vi.fn>
    ).mockResolvedValue(updated);
    const result = await returnExternalRepair(prisma, "er-1", {
      costFinal: 45,
    });
    expect(result).toBe(updated);
    const call = (prisma.externalRepair.updateMany as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(call.data.status).toBe("RETURNED");
    expect(call.data.costFinal).toBe(45);
    expect(call.data.returnedAt).toBeInstanceOf(Date);
  });
});

describe("cancelExternalRepair", () => {
  it("throws NOT_FOUND when repair does not exist", async () => {
    const prisma = mockPrisma();
    (
      prisma.externalRepair.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 0 });
    (
      prisma.externalRepair.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    await expect(cancelExternalRepair(prisma, "er-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects cancelling a repair that is no longer SENT", async () => {
    const prisma = mockPrisma();
    (
      prisma.externalRepair.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 0 });
    (
      prisma.externalRepair.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: "er-1" });
    await expect(cancelExternalRepair(prisma, "er-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("marks CANCELLED", async () => {
    const prisma = mockPrisma();
    (
      prisma.externalRepair.updateMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ count: 1 });
    const updated = { id: "er-1", status: "CANCELLED" };
    (
      prisma.externalRepair.findUniqueOrThrow as ReturnType<typeof vi.fn>
    ).mockResolvedValue(updated);
    const result = await cancelExternalRepair(prisma, "er-1");
    expect(result).toBe(updated);
    expect(prisma.externalRepair.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "er-1", status: "SENT" },
        data: { status: "CANCELLED" },
      })
    );
  });
});
