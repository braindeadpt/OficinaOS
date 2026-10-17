import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import { applyTaskRules, completeTask, createTask } from "../tasks.service.js";

describe("task automation", () => {
  it("creates one successor even when the completion request is retried", async () => {
    const task = {
      id: "t1",
      title: "Order part",
      nextTitle: "Await receipt",
      nextDelayHours: 24,
      jobId: "j1",
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
