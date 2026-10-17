import type { PrismaClient } from "@generated/client";
import {
  createTaskRuleSchema,
  updateTaskSchema,
} from "@shared/schemas/task.schema";
import { describe, expect, it, vi } from "vitest";
import { updateRule, updateTask } from "../tasks.service.js";

function fixture() {
  const task = {
    id: "t1",
    completedAt: null,
    scheduledAt: new Date("2026-10-17T10:00:00Z"),
    dueAt: new Date("2026-10-18T10:00:00Z"),
  };
  const tx = {
    workshopTask: {
      findUnique: vi.fn(async () => task),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: vi.fn(async () => ({ isActive: true, role: "TECHNICIAN" })),
    },
  };
  const prisma = {
    $transaction: async (fn: (db: typeof tx) => unknown) => await fn(tx),
  } as unknown as PrismaClient;
  return { task, tx, prisma };
}
describe("task editing", () => {
  it("clears optional fields without moving a task to another record", async () => {
    const { prisma, tx } = fixture();
    await updateTask(prisma, "t1", {
      title: "Await delivery",
      dueAt: null,
      assigneeId: null,
      nextTitle: null,
      notes: "Updated",
    });
    expect(tx.workshopTask.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", completedAt: null },
      data: expect.objectContaining({
        title: "Await delivery",
        dueAt: null,
        assigneeId: null,
        nextTitle: null,
        notes: "Updated",
      }),
    });
    expect(
      updateTaskSchema.safeParse({ entityType: "CUSTOMER", entityId: "other" })
        .success
    ).toBe(false);
  });
  it("checks dates against the saved start when only the deadline changes", async () => {
    const { prisma, tx } = fixture();
    await expect(
      updateTask(prisma, "t1", { dueAt: "2026-10-16T10:00:00Z" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
  });
  it("does not edit an already completed task", async () => {
    const { prisma, task, tx } = fixture();
    Object.assign(task, { completedAt: new Date() });
    await expect(
      updateTask(prisma, "t1", { title: "Changed" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
  });
  it("rejects an edit if completion wins the race", async () => {
    const { prisma, tx } = fixture();
    tx.workshopTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateTask(prisma, "t1", { title: "Changed" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("requires an active owner or technician for reassignment", async () => {
    const { prisma, tx } = fixture();
    tx.user.findUnique.mockResolvedValue({
      isActive: false,
      role: "TECHNICIAN",
    });
    await expect(
      updateTask(prisma, "t1", { assigneeId: "inactive" })
    ).rejects.toMatchObject({ code: "INVALID_TECHNICIAN" });
  });
});
describe("rule sections", () => {
  it("rejects a status belonging to another section", async () => {
    const prisma = {
      workflowState: { findFirst: vi.fn(async () => ({ entityType: "RMA" })) },
    } as unknown as PrismaClient;
    await expect(
      updateRule(
        prisma,
        "rule1",
        createTaskRuleSchema.parse({
          title: "Order",
          entityType: "ORDER",
          workflowStateId: "rma-state",
        })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("clears the old trigger and optional values when editing a rule", async () => {
    const update = vi.fn();
    const prisma = { taskRule: { update } } as unknown as PrismaClient;
    await updateRule(
      prisma,
      "rule1",
      createTaskRuleSchema.parse({
        title: "Repair",
        entityType: "JOB",
        triggerStatus: "IN_REPAIR",
      })
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "rule1" },
      data: expect.objectContaining({
        triggerStatus: "IN_REPAIR",
        workflowStateId: null,
        assigneeId: null,
        notes: null,
        nextTitle: null,
      }),
    });
  });
  it("does not allow a repair operational trigger on supplier rules", async () => {
    await expect(
      updateRule(
        {} as PrismaClient,
        "rule1",
        createTaskRuleSchema.parse({
          title: "Call",
          entityType: "SUPPLIER",
          triggerStatus: "IN_REPAIR",
        })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
