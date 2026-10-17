import {
  WORKFLOW_PERMISSIONS,
  WORKFLOW_TYPES,
  type WorkflowType,
} from "@shared/constants/workflow";
import { AppError } from "@shared/errors/app-error.js";
import {
  createTaskRuleSchema,
  createTaskSchema,
  taskListSchema,
  updateTaskSchema,
} from "@shared/schemas/task.schema";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  completeTask,
  createRule,
  createTask,
  updateRule,
  updateTask,
} from "../services/tasks.service.js";
import { authorizeWorkflow } from "../services/workflow.service.js";
import { getRole, getUserId } from "../utils/request.js";

async function taskScope(req: FastifyRequest) {
  const allowedTypes: WorkflowType[] = [];
  const editableTypes: string[] = [];
  for (const type of WORKFLOW_TYPES) {
    const allowed = await req.server.auth.api.userHasPermission({
      body: {
        role: getRole(req),
        permissions: WORKFLOW_PERMISSIONS[type].view,
      },
    });
    if (allowed.success) {
      allowedTypes.push(type);
      const edit = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: WORKFLOW_PERMISSIONS[type].edit,
        },
      });
      if (edit.success) {
        editableTypes.push(type);
      }
    }
  }
  const shopReturns = await req.server.auth.api.userHasPermission({
    body: { role: getRole(req), permissions: { returns: ["viewShop"] } },
  });
  const scopedReturns = shopReturns.success
    ? null
    : await req.server.prisma.returnClaim.findMany({
        where: {
          OR: [
            { openedById: getUserId(req) },
            { originalJob: { technicianId: getUserId(req) } },
            { reworkJob: { technicianId: getUserId(req) } },
          ],
        },
        select: { id: true },
      });
  return {
    editableTypes,
    where: {
      entityType: { in: allowedTypes },
      ...(scopedReturns
        ? {
            OR: [
              { entityType: { not: "RETURN" } },
              {
                entityType: "RETURN",
                entityId: { in: scopedReturns.map((claim) => claim.id) },
              },
            ],
          }
        : {}),
    },
  };
}

export const tasksRoutes: FastifyPluginAsync = (app) => {
  app.addHook("preHandler", requirePermission({ jobs: ["view"] }));
  app.get("/", async (req) => {
    const parsed = taskListSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR");
    }
    const { jobId, entityType, entityId, completed, cursor } = parsed.data;
    if (entityType) {
      await authorizeWorkflow(req, entityType, "view", entityId);
    }
    if (jobId) {
      await authorizeWorkflow(req, "JOB", "view", jobId);
    }
    const scope = await taskScope(req);
    const data = await app.prisma.workshopTask.findMany({
      where: {
        ...scope.where,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(jobId ? { jobId } : {}),
        completedAt: completed === "true" ? { not: null } : null,
      },
      include: {
        assignee: { select: { name: true, username: true } },
        job: { select: { id: true, jobCode: true } },
      },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return {
      data: data.map((task) => ({
        ...task,
        canEdit:
          !task.completedAt && scope.editableTypes.includes(task.entityType),
        canComplete:
          scope.editableTypes.includes(task.entityType) ||
          task.assigneeId === getUserId(req),
      })),
      nextCursor: data.length === 100 ? data.at(-1)?.id : null,
    };
  });
  app.post("/", {}, async (req, reply) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR");
    }
    await authorizeWorkflow(
      req,
      parsed.data.jobCode ? "JOB" : parsed.data.entityType,
      "edit",
      parsed.data.jobCode
        ? (
            await app.prisma.job.findUnique({
              where: { jobCode: parsed.data.jobCode },
              select: { id: true },
            })
          )?.id
        : parsed.data.entityId
    );
    return reply.status(201).send({
      data: await createTask(app.prisma, parsed.data, getUserId(req)),
    });
  });
  app.patch("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR");
    }
    const task = await app.prisma.workshopTask.findUnique({ where: { id } });
    if (!task) {
      throw new AppError("NOT_FOUND");
    }
    await authorizeWorkflow(
      req,
      task.entityType as WorkflowType,
      "edit",
      task.entityId ?? undefined
    );
    return { data: await updateTask(app.prisma, id, parsed.data) };
  });
  app.patch(
    "/rules/:id",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      const parsed = createTaskRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      return { data: await updateRule(app.prisma, id, parsed.data) };
    }
  );
  app.post("/:id/complete", {}, async (req) => {
    const { id } = req.params as { id: string };
    const task = await app.prisma.workshopTask.findUnique({ where: { id } });
    if (!task) {
      throw new AppError("NOT_FOUND");
    }
    await authorizeWorkflow(
      req,
      task.entityType as WorkflowType,
      task.assigneeId === getUserId(req) ? "view" : "edit",
      task.entityId ?? undefined
    );
    return { data: await completeTask(app.prisma, id) };
  });
  app.get(
    "/rules",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async () => ({
      data: await app.prisma.taskRule.findMany({
        include: {
          workflowState: { select: { name: true, entityType: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    })
  );
  app.post(
    "/rules",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req, reply) => {
      const parsed = createTaskRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      return reply.status(201).send({
        data: await createRule(app.prisma, parsed.data, getUserId(req)),
      });
    }
  );
  app.patch(
    "/rules/:id/disable",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      const rule = await app.prisma.taskRule.findUnique({ where: { id } });
      if (!rule) {
        throw new AppError("NOT_FOUND");
      }
      return {
        data: await app.prisma.taskRule.update({
          where: { id },
          data: { isActive: false },
        }),
      };
    }
  );
  return Promise.resolve();
};
