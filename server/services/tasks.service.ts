import type { Prisma, PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  CreateTaskInput,
  CreateTaskRuleInput,
} from "@shared/schemas/task.schema";

async function validateAssignee(prisma: PrismaClient, id?: string) {
  if (!id) {
    return;
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!(user?.isActive && ["OWNER", "TECHNICIAN"].includes(user.role))) {
    throw new AppError("INVALID_TECHNICIAN");
  }
}

export async function createTask(
  prisma: PrismaClient,
  input: CreateTaskInput,
  userId: string
) {
  await validateAssignee(prisma, input.assigneeId);
  const { jobCode, scheduledAt, dueAt, ...data } = input;
  const job = jobCode
    ? await prisma.job.findUnique({ where: { jobCode } })
    : null;
  if (jobCode && !job) {
    throw new AppError("JOB_NOT_FOUND");
  }
  return prisma.workshopTask.create({
    data: {
      ...data,
      entityType: job ? "JOB" : data.entityType,
      entityId: job?.id ?? data.entityId,
      jobId: job?.id ?? (data.entityType === "JOB" ? data.entityId : undefined),
      createdById: userId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      dueAt: dueAt ? new Date(dueAt) : null,
    },
  });
}

export function completeTask(prisma: PrismaClient, id: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.workshopTask.findUnique({ where: { id } });
    if (!task) {
      throw new AppError("NOT_FOUND");
    }
    if (task.completedAt) {
      return task;
    }
    const result = await tx.workshopTask.updateMany({
      where: { id, completedAt: null },
      data: { completedAt: new Date() },
    });
    if (result.count && task.nextTitle) {
      await tx.workshopTask.create({
        data: {
          title: task.nextTitle,
          jobId: task.jobId,
          entityType: task.entityType,
          entityId: task.entityId,
          assigneeId: task.assigneeId,
          priority: task.priority,
          createdById: task.createdById,
          predecessorId: task.id,
          scheduledAt: new Date(Date.now() + task.nextDelayHours * 3_600_000),
        },
      });
    }
    return tx.workshopTask.findUnique({ where: { id } });
  });
}

export async function createRule(
  prisma: PrismaClient,
  input: CreateTaskRuleInput,
  userId: string
) {
  await validateAssignee(prisma, input.assigneeId);
  if (input.workflowStateId) {
    const state = await prisma.workflowState.findFirst({
      where: { id: input.workflowStateId, isActive: true },
    });
    if (!state) {
      throw new AppError("VALIDATION_ERROR");
    }
  }
  return prisma.taskRule.create({ data: { ...input, createdById: userId } });
}

/** Reconcile persisted rules after restart; the unique key prevents duplicates. */
export async function applyTaskRules(prisma: PrismaClient) {
  const rules = await prisma.taskRule.findMany({ where: { isActive: true } });
  for (const rule of rules) {
    if (rule.workflowStateId) {
      await reconcileWorkflowRule(prisma, rule);
      continue;
    }
    if (!rule.triggerStatus) {
      continue;
    }
    let cursor: string | undefined;
    for (;;) {
      const jobs = await prisma.job.findMany({
        where: {
          OR: [
            { status: rule.triggerStatus },
            {
              auditLogs: {
                some: {
                  action: "STATUS_CHANGED",
                  toValue: rule.triggerStatus,
                  createdAt: { gte: rule.createdAt },
                },
              },
            },
          ],
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
        select: { id: true },
      });
      for (const job of jobs) {
        await prisma.workshopTask.upsert({
          where: { triggerKey: `${rule.id}:${job.id}` },
          update: {},
          create: {
            triggerKey: `${rule.id}:${job.id}`,
            title: rule.title,
            notes: rule.notes,
            jobId: job.id,
            entityType: "JOB",
            entityId: job.id,
            assigneeId: rule.assigneeId,
            priority: rule.priority,
            nextTitle: rule.nextTitle,
            nextDelayHours: rule.nextDelayHours,
            createdById: rule.createdById,
            scheduledAt: new Date(Date.now() + rule.delayHours * 3_600_000),
          },
        });
      }
      if (jobs.length < 100) {
        break;
      }
      cursor = jobs.at(-1)?.id;
    }
  }
}

type RuleData = Awaited<
  ReturnType<PrismaClient["taskRule"]["findMany"]>
>[number];
interface WorkflowRecord {
  entityId: string;
  entityType: string;
  stateId: string;
}
function createWorkflowTask(
  prisma: Prisma.TransactionClient,
  rule: RuleData,
  record: WorkflowRecord
) {
  return prisma.workshopTask.upsert({
    where: { triggerKey: `${rule.id}:${record.entityType}:${record.entityId}` },
    update: {},
    create: {
      triggerKey: `${rule.id}:${record.entityType}:${record.entityId}`,
      title: rule.title,
      notes: rule.notes,
      priority: rule.priority,
      entityType: record.entityType,
      entityId: record.entityId,
      jobId: record.entityType === "JOB" ? record.entityId : null,
      assigneeId: rule.assigneeId,
      createdById: rule.createdById,
      nextTitle: rule.nextTitle,
      nextDelayHours: rule.nextDelayHours,
      scheduledAt: new Date(Date.now() + rule.delayHours * 3_600_000),
    },
  });
}
async function reconcileWorkflowRule(prisma: PrismaClient, rule: RuleData) {
  let cursor: string | undefined;
  for (;;) {
    const records = await prisma.recordWorkflow.findMany({
      where: {
        stateId: rule.workflowStateId ?? undefined,
        state: { isActive: true },
      },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const record of records) {
      await createWorkflowTask(prisma, rule, record);
    }
    if (records.length < 100) {
      break;
    }
    cursor = records.at(-1)?.id;
  }
}
export async function applyWorkflowTaskRules(
  prisma: Prisma.TransactionClient,
  record: WorkflowRecord
) {
  const rules = await prisma.taskRule.findMany({
    where: { workflowStateId: record.stateId, isActive: true },
  });
  for (const rule of rules) {
    await createWorkflowTask(prisma, rule, record);
  }
}
