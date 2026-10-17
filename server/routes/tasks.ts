import { AppError } from "@shared/errors/app-error.js";
import {
  createTaskRuleSchema,
  createTaskSchema,
  taskListSchema,
} from "@shared/schemas/task.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  completeTask,
  createRule,
  createTask,
} from "../services/tasks.service.js";
import { getUserId } from "../utils/request.js";

export const tasksRoutes: FastifyPluginAsync = (app) => {
  app.addHook("preHandler", requirePermission({ jobs: ["view"] }));
  app.get("/", async (req) => {
    const parsed = taskListSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR");
    }
    const { jobId, completed, cursor } = parsed.data;
    const data = await app.prisma.workshopTask.findMany({
      where: {
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
    return { data, nextCursor: data.length === 100 ? data.at(-1)?.id : null };
  });
  app.post(
    "/",
    { preHandler: requirePermission({ jobs: ["edit"] }) },
    async (req, reply) => {
      const parsed = createTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      return reply.status(201).send({
        data: await createTask(app.prisma, parsed.data, getUserId(req)),
      });
    }
  );
  app.post(
    "/:id/complete",
    { preHandler: requirePermission({ jobs: ["edit"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      return { data: await completeTask(app.prisma, id) };
    }
  );
  app.get(
    "/rules",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async () => ({
      data: await app.prisma.taskRule.findMany({
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
