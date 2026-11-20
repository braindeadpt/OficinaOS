import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOldAuditLogs,
  createAuditLog,
} from "../services/audit.service.js";

const auditLogCreate = vi.fn();
const auditLogDeleteMany = vi.fn();

const prisma = {
  auditLog: { create: auditLogCreate, deleteMany: auditLogDeleteMany },
} as unknown as Parameters<typeof createAuditLog>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAuditLog", () => {
  it("creates an audit log entry with all fields", async () => {
    auditLogCreate.mockResolvedValue({ id: "al-1" });

    await createAuditLog(prisma, {
      action: "STATUS_CHANGED",
      userId: "user-1",
      jobId: "job-1",
      fromValue: "RECEIVED",
      toValue: "DIAGNOSING",
      note: "Started diagnosis",
      metadata: { source: "dashboard" },
    });

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        action: "STATUS_CHANGED",
        userId: "user-1",
        jobId: "job-1",
        fromValue: "RECEIVED",
        toValue: "DIAGNOSING",
        note: "Started diagnosis",
        metadata: { source: "dashboard" },
      },
    });
  });

  it("creates an audit log entry with only required fields", async () => {
    auditLogCreate.mockResolvedValue({ id: "al-2" });

    await createAuditLog(prisma, {
      action: "JOB_CREATED",
      userId: "user-1",
      jobId: "job-1",
    });

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        action: "JOB_CREATED",
        userId: "user-1",
        jobId: "job-1",
        fromValue: undefined,
        toValue: undefined,
        note: undefined,
        metadata: undefined,
      },
    });
  });

  it("handles null jobId (user-level actions not tied to a job)", async () => {
    auditLogCreate.mockResolvedValue({ id: "al-3" });

    await createAuditLog(prisma, {
      action: "USER_SIGN_IN",
      userId: "user-1",
      jobId: null,
    });

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: null,
        userId: "user-1",
        action: "USER_SIGN_IN",
      }),
    });
  });

  it("handles null userId (system actions)", async () => {
    auditLogCreate.mockResolvedValue({ id: "al-4" });

    await createAuditLog(prisma, {
      action: "NOTIFICATION_SENT",
      userId: null as unknown as string,
      jobId: "job-1",
    });

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        jobId: "job-1",
        action: "NOTIFICATION_SENT",
      }),
    });
  });

  it("omits metadata when undefined", async () => {
    auditLogCreate.mockResolvedValue({ id: "al-5" });

    await createAuditLog(prisma, {
      action: "NOTE_ADDED",
      userId: "user-1",
      jobId: "job-1",
      note: "Customer called",
    });

    const call = auditLogCreate.mock.calls[0][0];
    expect(call.data.metadata).toBeUndefined();
    expect(call.data.note).toBe("Customer called");
  });
});

describe("cleanupOldAuditLogs", () => {
  it("deletes entries older than 24 months", async () => {
    auditLogDeleteMany.mockResolvedValue({ count: 3 });

    await cleanupOldAuditLogs(prisma);

    const call = auditLogDeleteMany.mock.calls[0][0];
    const cutoff = call.where.createdAt.lt as Date;
    const expectedMin = new Date();
    expectedMin.setMonth(expectedMin.getMonth() - 24);
    // Cutoff was computed moments ago — it must sit just under 24 months back.
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMin.getTime());
    expect(cutoff.getTime()).toBeGreaterThan(expectedMin.getTime() - 60_000);
  });
});
