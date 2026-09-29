import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/constants", () => ({
  INACTIVE_STATUSES: ["DELIVERED", "RETURNED", "CANCELLED"],
}));

const mocks = vi.hoisted(() => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/notification-dispatch.js", () => ({
  notify: mocks.notify,
}));

vi.useFakeTimers();

const mockFindMany = vi.fn();
const mockJobUpdate = vi.fn().mockResolvedValue(undefined);
const mockLog = { error: vi.fn(), warn: vi.fn() };

const mockApp = {
  log: mockLog,
  prisma: { job: { findMany: mockFindMany, update: mockJobUpdate } },
} as any;

import { startOverdueScheduler } from "../jobs/overdue-scheduler.js";

describe("startOverdueScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls notify for overdue jobs not in terminal status", async () => {
    mockFindMany.mockResolvedValue([
      { id: "j1", jobCode: "RPR-001" },
      { id: "j2", jobCode: "RPR-002" },
    ]);

    const stop = startOverdueScheduler(mockApp);

    await vi.advanceTimersByTimeAsync(50);

    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith(mockApp, {
      context: { jobCode: "RPR-001" },
      eventName: "job_overdue",
      jobId: "j1",
      recipients: { role: "OWNER" },
    });
    expect(mocks.notify).toHaveBeenCalledWith(mockApp, {
      context: { jobCode: "RPR-002" },
      eventName: "job_overdue",
      jobId: "j2",
      recipients: { role: "OWNER" },
    });

    stop();
  });

  it("passes customer name and phone so WhatsApp template vars render", async () => {
    mockFindMany.mockResolvedValue([
      {
        customer: { name: "Ana Silva", phone: "+351910000001" },
        id: "j1",
        jobCode: "RPR-001",
      },
    ]);

    const stop = startOverdueScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mocks.notify).toHaveBeenCalledWith(mockApp, {
      context: {
        customerName: "Ana Silva",
        jobCode: "RPR-001",
        recipientPhone: "+351910000001",
      },
      eventName: "job_overdue",
      jobId: "j1",
      recipients: { role: "OWNER" },
    });

    stop();
  });

  it("deduplicates already-alerted jobs on second tick", async () => {
    mockFindMany
      .mockResolvedValueOnce([{ id: "j1", jobCode: "RPR-001" }])
      .mockResolvedValueOnce([]);

    const stop = startOverdueScheduler(mockApp);

    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(mocks.notify).toHaveBeenCalledTimes(1);

    stop();
  });

  it("clears interval on stop without error", () => {
    mockFindMany.mockResolvedValue([]);
    const stop = startOverdueScheduler(mockApp);
    stop();
    expect(true).toBe(true);
  });
});
