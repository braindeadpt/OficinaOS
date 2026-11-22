import { AuditAction } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { add, remove } from "../services/job-waiting-parts.service.js";

const mocks = vi.hoisted(() => ({
  jobFindUnique: vi.fn(),
  jobPartsWaitingCreate: vi.fn(),
  jobPartsWaitingFindFirst: vi.fn(),
  jobPartsWaitingDelete: vi.fn(),
  auditLogCreate: vi.fn(),
}));

const prismaBase = {
  job: { findUnique: mocks.jobFindUnique },
  jobPartsWaiting: {
    create: mocks.jobPartsWaitingCreate,
    findFirst: mocks.jobPartsWaitingFindFirst,
    delete: mocks.jobPartsWaitingDelete,
  },
  auditLog: { create: mocks.auditLogCreate },
};
const prisma = {
  ...prismaBase,
} as unknown as import("@generated/client").PrismaClient;
(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(
  async (fn: (tx: typeof prisma) => unknown) => await fn(prisma)
);

vi.mock("../services/audit.service.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

describe("job-waiting-parts service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("add", () => {
    it("returns null when job does not exist", async () => {
      mocks.jobFindUnique.mockResolvedValue(null);

      const result = await add(
        prisma,
        "job-1",
        { partName: "Battery" },
        "user-1"
      );

      expect(result).toBeNull();
      expect(mocks.jobPartsWaitingCreate).not.toHaveBeenCalled();
    });

    it("returns JOB_IN_TERMINAL_STATUS when job is in inactive status", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "DELIVERED",
      });

      const result = await add(
        prisma,
        "job-1",
        { partName: "Battery" },
        "user-1"
      );

      expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
      expect(mocks.jobPartsWaitingCreate).not.toHaveBeenCalled();
    });

    it("creates a waiting part and audit log for an active job", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "IN_REPAIR",
      });
      const waitingPart = {
        id: "wp-1",
        jobId: "job-1",
        partName: "Battery",
        supplier: "Acme",
      };
      mocks.jobPartsWaitingCreate.mockResolvedValue(waitingPart);

      const result = await add(
        prisma,
        "job-1",
        { partName: "Battery", supplier: "Acme" },
        "user-1"
      );

      expect(result).toEqual(waitingPart);
      expect(mocks.jobPartsWaitingCreate).toHaveBeenCalledWith({
        data: {
          expectedAt: null,
          job: { connect: { id: "job-1" } },
          partName: "Battery",
          supplier: "Acme",
        },
      });
    });

    it("passes expectedAt through as a Date", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "WAITING_FOR_PARTS",
      });
      mocks.jobPartsWaitingCreate.mockResolvedValue({ id: "wp-3" });

      await add(
        prisma,
        "job-1",
        { expectedAt: "2026-01-10T00:00:00.000Z", partName: "Screen" },
        "user-1"
      );

      expect(mocks.jobPartsWaitingCreate).toHaveBeenCalledWith({
        data: {
          expectedAt: new Date("2026-01-10T00:00:00.000Z"),
          job: { connect: { id: "job-1" } },
          partName: "Screen",
          supplier: null,
        },
      });
    });

    it("sets supplier to null when not provided", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "WAITING_FOR_PARTS",
      });
      mocks.jobPartsWaitingCreate.mockResolvedValue({
        id: "wp-2",
        jobId: "job-1",
        partName: "Screen",
        supplier: null,
      });

      const result = await add(
        prisma,
        "job-1",
        { partName: "Screen" },
        "user-1"
      );

      expect(result).toEqual({
        id: "wp-2",
        jobId: "job-1",
        partName: "Screen",
        supplier: null,
      });
      expect(mocks.jobPartsWaitingCreate).toHaveBeenCalledWith({
        data: {
          expectedAt: null,
          job: { connect: { id: "job-1" } },
          partName: "Screen",
          supplier: null,
        },
      });
    });

    it("rejects adding to CANCELLED job", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "CANCELLED",
      });

      const result = await add(
        prisma,
        "job-1",
        { partName: "Battery" },
        "user-1"
      );

      expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
    });

    it("creates audit log with PART_ADDED action", async () => {
      const { createAuditLog } = await import("../services/audit.service.js");
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "IN_REPAIR",
      });
      mocks.jobPartsWaitingCreate.mockResolvedValue({
        id: "wp-1",
        jobId: "job-1",
        partName: "Battery",
        supplier: null,
      });

      await add(prisma, "job-1", { partName: "Battery" }, "user-1");

      expect(createAuditLog).toHaveBeenCalledWith(prisma, {
        jobId: "job-1",
        userId: "user-1",
        action: AuditAction.PART_ADDED,
        note: "Waiting part added: Battery",
        toValue: "Battery",
      });
    });
  });

  describe("remove", () => {
    it("returns null when waiting part does not exist", async () => {
      mocks.jobPartsWaitingFindFirst.mockResolvedValue(null);

      const result = await remove(prisma, "job-1", "wp-999", "user-1");

      expect(result).toBeNull();
      expect(mocks.jobPartsWaitingDelete).not.toHaveBeenCalled();
    });

    it("deletes the waiting part and returns true", async () => {
      const waitingPart = {
        id: "wp-1",
        jobId: "job-1",
        partName: "Battery",
        supplier: "Acme",
      };
      mocks.jobPartsWaitingFindFirst.mockResolvedValue(waitingPart);
      mocks.jobPartsWaitingDelete.mockResolvedValue(waitingPart);

      const result = await remove(prisma, "job-1", "wp-1", "user-1");

      expect(result).toBe(true);
      expect(mocks.jobPartsWaitingDelete).toHaveBeenCalledWith({
        where: { id: "wp-1" },
      });
    });

    it("creates audit log with PART_REMOVED action", async () => {
      const { createAuditLog } = await import("../services/audit.service.js");
      const waitingPart = {
        id: "wp-1",
        jobId: "job-1",
        partName: "Battery",
        supplier: "Acme",
      };
      mocks.jobPartsWaitingFindFirst.mockResolvedValue(waitingPart);
      mocks.jobPartsWaitingDelete.mockResolvedValue(waitingPart);

      await remove(prisma, "job-1", "wp-1", "user-1");

      expect(createAuditLog).toHaveBeenCalledWith(prisma, {
        jobId: "job-1",
        userId: "user-1",
        action: AuditAction.PART_REMOVED,
        note: "Waiting part removed: Battery",
        fromValue: "Battery",
      });
    });

    it("does not delete when waiting part belongs to a different job", async () => {
      mocks.jobPartsWaitingFindFirst.mockResolvedValue(null);

      const result = await remove(prisma, "job-2", "wp-1", "user-1");

      expect(result).toBeNull();
      expect(mocks.jobPartsWaitingDelete).not.toHaveBeenCalled();
    });
  });
});
