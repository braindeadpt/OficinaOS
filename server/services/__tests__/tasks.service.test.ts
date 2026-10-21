import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import {
  applyTaskRules,
  applyWorkflowTaskRules,
  completeTask,
  createTask,
} from "../tasks.service.js";

describe("task automation", () => {
  it("creates one successor even when the completion request is retried", async () => {
    const task = {
      id: "t1",
      title: "Order part",
      nextTitle: "Await receipt",
      nextDelayHours: 24,
      jobId: "j1",
      entityType: "JOB",
      entityId: "j1",
      assigneeId: "u1",
      priority: "HIGH",
      createdById: "u1",
      completedAt: null as Date | null,
    };
    const create = vi.fn();
    const tx = {
      workshopTask: {
        findUnique: vi.fn(() => ({ ...task })),
        updateMany: vi.fn(() => {
          task.completedAt = new Date();
          return { count: 1 };
        }),
        create,
      },
    };
    const prisma = {
      $transaction: (fn: (db: typeof tx) => unknown) => fn(tx),
    } as unknown as PrismaClient;
    await completeTask(prisma, "t1");
    await completeTask(prisma, "t1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Await receipt",
        jobId: "j1",
        assigneeId: "u1",
        predecessorId: "t1",
        entityType: "JOB",
        entityId: "j1",
      }),
    });
    expect(create.mock.calls[0][0].data.scheduledAt.getTime()).toBeGreaterThan(
      Date.now() + 23 * 3_600_000
    );
  });

  it("does not create another successor after losing a concurrent completion", async () => {
    const create = vi.fn();
    const tx = {
      workshopTask: {
        findUnique: vi.fn(() => ({
          id: "t1",
          completedAt: null,
          nextTitle: "Await receipt",
        })),
        updateMany: vi.fn(() => ({ count: 0 })),
        create,
      },
    };
    await completeTask(
      {
        $transaction: (fn: (db: typeof tx) => unknown) => fn(tx),
      } as unknown as PrismaClient,
      "t1"
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects inactive assignees before creating a task", async () => {
    const create = vi.fn();
    const prisma = {
      user: { findUnique: vi.fn(() => ({ isActive: false, role: "OWNER" })) },
      workshopTask: { create },
    } as unknown as PrismaClient;
    await expect(
      createTask(
        prisma,
        {
          title: "Order part",
          entityType: "GENERAL",
          assigneeId: "u1",
          priority: "NORMAL",
          nextDelayHours: 0,
        },
        "u1"
      )
    ).rejects.toMatchObject({ code: "INVALID_TECHNICIAN" });
    expect(create).not.toHaveBeenCalled();
  });

  it("reconciles a rule with a stable key so restarts do not duplicate tasks", async () => {
    const upsert = vi.fn();
    const ruleCreatedAt = new Date("2026-11-09T10:00:00Z");
    const findLogs = vi.fn((_args: { where: Record<string, unknown> }) => [
      {
        id: "log1",
        jobId: "job1",
        createdAt: new Date("2026-11-09T11:00:00Z"),
      },
    ]);
    const prisma = {
      taskRule: {
        findMany: vi.fn(() => [
          {
            id: "rule1",
            title: "Order part",
            triggerStatus: "WAITING_FOR_PARTS",
            delayHours: 0,
            createdAt: ruleCreatedAt,
            createdById: "u1",
            nextDelayHours: 0,
            scanCursor: null,
          },
        ]),
        update: vi.fn(),
      },
      auditLog: { findMany: findLogs },
      workshopTask: { upsert },
    } as unknown as PrismaClient;
    await applyTaskRules(prisma);
    await applyTaskRules(prisma);
    expect(upsert.mock.calls.map(([arg]) => arg.where.triggerKey)).toEqual([
      "rule1:job1",
      "rule1:job1",
    ]);
    expect(upsert.mock.calls[0][0].update).toEqual({});
    // Forward-only: the stream never reaches transitions older than the rule.
    expect(findLogs.mock.calls[0][0].where).toMatchObject({
      action: "STATUS_CHANGED",
      toValue: "WAITING_FOR_PARTS",
      createdAt: { gte: ruleCreatedAt },
    });
  });

  it("fires an INTAKE rule on JOB_CREATED rows — jobs are born without STATUS_CHANGED", async () => {
    const upsert = vi.fn();
    const ruleCreatedAt = new Date("2026-11-09T10:00:00Z");
    const findLogs = vi.fn((_args: { where: Record<string, unknown> }) => [
      {
        id: "log1",
        jobId: "job1",
        createdAt: new Date("2026-11-09T11:00:00Z"),
      },
    ]);
    const prisma = {
      taskRule: {
        findMany: vi.fn(() => [
          {
            id: "rule1",
            title: "Intake checklist",
            triggerStatus: "INTAKE",
            delayHours: 0,
            createdAt: ruleCreatedAt,
            createdById: "u1",
            nextDelayHours: 0,
            scanCursor: null,
          },
        ]),
        update: vi.fn(),
      },
      auditLog: { findMany: findLogs },
      workshopTask: { upsert },
    } as unknown as PrismaClient;
    await applyTaskRules(prisma);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].where.triggerKey).toBe("rule1:job1");
    // INTAKE rules read BOTH transition kinds — and keep the same
    // forward-only gate, so jobs imported/created before the rule
    // (JOB_CREATED rows stamped earlier) never fire.
    expect(findLogs.mock.calls[0][0].where).toMatchObject({
      OR: [
        { action: "STATUS_CHANGED", toValue: "INTAKE" },
        { action: "JOB_CREATED" },
      ],
      createdAt: { gte: ruleCreatedAt },
    });
  });

  it("keeps deduping a JOB_CREATED + STATUS_CHANGED pair on the same job", async () => {
    const upsert = vi.fn();
    const findLogs = vi.fn((_args: { where: Record<string, unknown> }) => [
      {
        id: "log1",
        jobId: "job1",
        createdAt: new Date("2026-11-09T11:00:00Z"),
      },
      {
        id: "log2",
        jobId: "job1",
        createdAt: new Date("2026-11-09T12:00:00Z"),
      },
    ]);
    const prisma = {
      taskRule: {
        findMany: vi.fn(() => [
          {
            id: "rule1",
            title: "Intake checklist",
            triggerStatus: "INTAKE",
            delayHours: 0,
            createdAt: new Date("2026-11-09T10:00:00Z"),
            createdById: "u1",
            nextDelayHours: 0,
            scanCursor: null,
          },
        ]),
        update: vi.fn(),
      },
      auditLog: { findMany: findLogs },
      workshopTask: { upsert },
    } as unknown as PrismaClient;
    await applyTaskRules(prisma);
    // Both stream rows upsert under the same unique triggerKey — the
    // DB collapses them to one task.
    expect(upsert.mock.calls.map(([arg]) => arg.where.triggerKey)).toEqual([
      "rule1:job1",
      "rule1:job1",
    ]);
  });
});

describe("custom status task rules", () => {
  it("uses a stable key and preserves order context when reconciling a custom state", async () => {
    const upsert = vi.fn();
    const prisma = {
      taskRule: {
        findMany: vi.fn(async () => [
          {
            id: "rule1",
            title: "Await part",
            priority: "NORMAL",
            delayHours: 24,
            nextDelayHours: 0,
            createdById: "u1",
          },
        ]),
      },
      workshopTask: { upsert },
    };
    const record = { entityType: "ORDER", entityId: "o1", stateId: "state1" };
    await applyWorkflowTaskRules(prisma as never, record);
    await applyWorkflowTaskRules(prisma as never, record);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.map(([input]) => input.where.triggerKey)).toEqual([
      "rule1:ORDER:o1",
      "rule1:ORDER:o1",
    ]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
        create: expect.objectContaining({
          entityType: "ORDER",
          entityId: "o1",
          jobId: null,
          title: "Await part",
        }),
      })
    );
  });
});
