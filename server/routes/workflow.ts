import { WORKFLOW_TYPES } from "@shared/constants/workflow";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.js";
import { applyWorkflowTaskRules } from "../services/tasks.service.js";
import { authorizeWorkflow } from "../services/workflow.service.js";
import { parseInput } from "../utils/parse-input.js";

const contextSchema = z.object({
  entityType: z.enum(WORKFLOW_TYPES),
  entityId: z.string().min(1),
});
const stateSchema = z.object({
  entityType: z.enum(WORKFLOW_TYPES),
  name: z.string().trim().min(1).max(100),
});
export const workflowRoutes: FastifyPluginAsync = (app) => {
  app.addHook("preHandler", requirePermission({ jobs: ["view"] }));
  app.get("/", async (req) => {
    const context = parseInput(contextSchema, req.query);
    await authorizeWorkflow(req, context.entityType, "view", context.entityId);
    const [states, record] = await Promise.all([
      app.prisma.workflowState.findMany({
        where: { entityType: context.entityType },
        orderBy: { name: "asc" },
      }),
      app.prisma.recordWorkflow.findUnique({
        where: { entityType_entityId: context },
      }),
    ]);
    return { states, stateId: record?.stateId ?? null };
  });
  app.get(
    "/states",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req) => {
      const query = parseInput(
        z.object({
          entityType: z.enum(WORKFLOW_TYPES).optional(),
          includeInactive: z.enum(["true", "false"]).optional(),
        }),
        req.query
      );
      return {
        data: await app.prisma.workflowState.findMany({
          where: {
            entityType: query.entityType,
            ...(query.includeInactive === "true" ? {} : { isActive: true }),
          },
          orderBy: [{ entityType: "asc" }, { name: "asc" }],
        }),
      };
    }
  );
  app.post(
    "/states",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req, reply) => {
      const data = parseInput(stateSchema, req.body);
      return reply
        .status(201)
        .send({ data: await app.prisma.workflowState.create({ data }) });
    }
  );
  app.patch(
    "/states/:id",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      const data = parseInput(
        z.object({
          name: z.string().trim().min(1).max(100).optional(),
          isActive: z.boolean().optional(),
        }),
        req.body
      );
      const updated = await app.prisma.workflowState.updateMany({
        where: { id },
        data,
      });
      if (!updated.count) {
        throw new AppError("NOT_FOUND");
      }
      return {
        data: await app.prisma.workflowState.findUnique({ where: { id } }),
      };
    }
  );
  app.put("/", async (req) => {
    const { stateId, ...context } = parseInput(
      contextSchema.extend({ stateId: z.string().min(1).nullable() }),
      req.body
    );
    await authorizeWorkflow(req, context.entityType, "edit", context.entityId);
    if (!stateId) {
      await app.prisma.recordWorkflow.deleteMany({ where: context });
      return { success: true };
    }
    const state = await app.prisma.workflowState.findFirst({
      where: { id: stateId, entityType: context.entityType, isActive: true },
    });
    if (!state) {
      throw new AppError("VALIDATION_ERROR");
    }
    return {
      data: await app.prisma.$transaction(async (tx) => {
        const current = await tx.recordWorkflow.findUnique({
          where: { entityType_entityId: context },
        });
        // Re-writing the SAME state must not touch the row — @updatedAt
        // would bump and the task-rule stream would read a fresh
        // transition that never happened.
        if (current?.stateId === stateId) {
          return current;
        }
        const record = await tx.recordWorkflow.upsert({
          where: { entityType_entityId: context },
          create: { ...context, stateId },
          update: { stateId },
        });
        await applyWorkflowTaskRules(tx, record);
        return record;
      }),
    };
  });
  return Promise.resolve();
};
