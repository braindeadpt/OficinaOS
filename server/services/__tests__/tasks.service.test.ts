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
    const prisma = {
      taskRule: {
        findMany: vi.fn(() => [
          {
            id: "rule1",
            title: "Order part",
            triggerStatus: "WAITING_FOR_PARTS",
            delayHours: 0,
            createdAt: new Date(),
            createdById: "u1",
            nextDelayHours: 0,
          },
        ]),
      },
      job: { findMany: vi.fn(() => [{ id: "job1" }]) },
      workshopTask: { upsert },
    } as unknown as PrismaClient;
    await applyTaskRules(prisma);
    await applyTaskRules(prisma);
    expect(upsert.mock.calls.map(([arg]) => arg.where.triggerKey)).toEqual([
      "rule1:job1",
      "rule1:job1",
    ]);
    expect(upsert.mock.calls[0][0].update).toEqual({});
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
