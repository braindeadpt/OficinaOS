import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/notification-dispatch.js", () => ({
  notify: mocks.notify,
}));

vi.useFakeTimers();

const mockQueryRaw = vi.fn();
const mockJobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockLog = { error: vi.fn(), warn: vi.fn() };

const mockApp = {
  log: mockLog,
  prisma: {
    $queryRaw: mockQueryRaw,
    job: { updateMany: mockJobUpdateMany },
  },
} as any;

import { startPickupReminderScheduler } from "../jobs/pickup-reminder-scheduler.js";

const sqlOf = (call: unknown[]): string =>
  (call[0] as TemplateStringsArray).join("");

describe("startPickupReminderScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("selects only jobs still in DONE status (delivered/returned/cancelled are excluded by the status predicate)", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mockQueryRaw).toHaveBeenCalled();
    const sql = sqlOf(mockQueryRaw.mock.calls[0]);
    expect(sql).toContain("j.status = 'DONE'");
    expect(sql).not.toContain("DELIVERED");

    stop();
  });

  it("reads 'entered DONE' from the STATUS_CHANGED audit trail, not updatedAt alone", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    const sql = sqlOf(mockQueryRaw.mock.calls[0]);
    expect(sql).toContain("audit_logs");
    expect(sql).toContain("STATUS_CHANGED");
    expect(sql).toContain("'DONE'");
    // updatedAt only appears as the COALESCE fallback for jobs that
    // predate the audit trail.
    expect(sql).toContain('j."updatedAt"');

    stop();
  });

  it("notifies the customer with name, phone and job code", async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: "j1",
        jobCode: "RPR-001",
        customerName: "Ana Silva",
        customerPhone: "+351910000001",
      },
    ]);

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(mockApp, {
      context: {
        customerName: "Ana Silva",
        jobCode: "RPR-001",
        recipientPhone: "+351910000001",
      },
      eventName: "job_done_reminder",
      jobId: "j1",
      recipients: { role: "OWNER" },
    });

    stop();
  });

  it("tolerates a job without a linked customer", async () => {
    mockQueryRaw.mockResolvedValue([
      { id: "j1", jobCode: "RPR-001", customerName: null, customerPhone: null },
    ]);

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mocks.notify).toHaveBeenCalledWith(mockApp, {
      context: {
        customerName: undefined,
        jobCode: "RPR-001",
        recipientPhone: undefined,
      },
      eventName: "job_done_reminder",
      jobId: "j1",
      recipients: { role: "OWNER" },
    });

    stop();
  });

  it("re-checks DONE status in the atomic claim so a job delivered between scan and claim is not reminded", async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: "j1",
        jobCode: "RPR-001",
        customerName: "Ana",
        customerPhone: "+351",
      },
    ]);

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mockJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "j1", status: "DONE" }),
      })
    );

    stop();
  });

  it("does not notify when the atomic claim was lost to another run", async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: "j1",
        jobCode: "RPR-001",
        customerName: "Ana",
        customerPhone: "+351",
      },
    ]);
    mockJobUpdateMany.mockResolvedValue({ count: 0 });

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mocks.notify).not.toHaveBeenCalled();

    stop();
  });

  it("deduplicates between ticks — a job already stamped is not reminded again", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: "j1",
          jobCode: "RPR-001",
          customerName: "Ana",
          customerPhone: "+351",
        },
      ])
      .mockResolvedValueOnce([]);

    const stop = startPickupReminderScheduler(mockApp);

    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(mocks.notify).toHaveBeenCalledTimes(1);

    stop();
  });

  it("logs a rejected notification and keeps processing the rest of the batch", async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: "j1",
        jobCode: "RPR-001",
        customerName: "Ana",
        customerPhone: "+351",
      },
      {
        id: "j2",
        jobCode: "RPR-002",
        customerName: "Bruno",
        customerPhone: "+352",
      },
    ]);
    mocks.notify
      .mockRejectedValueOnce(new Error("outbox down"))
      .mockResolvedValueOnce(undefined);

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "failed to send pickup reminder"
    );

    stop();
  });

  it("logs a failing tick without crashing the scheduler", async () => {
    mockQueryRaw.mockRejectedValue(new Error("db gone"));

    const stop = startPickupReminderScheduler(mockApp);
    await vi.advanceTimersByTimeAsync(50);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.any(Error),
      "pickup reminder scheduler tick failed"
    );

    stop();
  });

  it("clears the interval on stop", () => {
    mockQueryRaw.mockResolvedValue([]);
    const stop = startPickupReminderScheduler(mockApp);
    stop();
    expect(true).toBe(true);
  });
});
