import { AppError } from "@shared/errors/app-error.js";
import {
  externalRepairCreateSchema,
  externalRepairReturnSchema,
} from "@shared/schemas/external-repair.schema.js";
import type { FastifyPluginCallback } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  cancelExternalRepair,
  createExternalRepair,
  listExternalRepairs,
  returnExternalRepair,
} from "../services/external-repair.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const jobParams = {
  properties: { id: { type: "string" } },
  required: ["id"],
  type: "object",
} as const;

const repairParams = {
  properties: { repairId: { type: "string" } },
  required: ["repairId"],
  type: "object",
} as const;

// External repairs — device sent out for warranty or third-party repair.
// Nested send/list under the job; return/cancel by repair id.
export const externalRepairsRoutes: FastifyPluginCallback = (
  app,
  _opts,
  done
) => {
  app.post(
    "/jobs/:id/external-repairs",
    {
      preHandler: [requirePermission({ jobs: ["edit"] })],
      schema: {
        tags: ["jobs"],
        summary: "Send job device for external repair",
        params: jobParams,
      },
    },
    async (req, reply) => {
      const parsed = externalRepairCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const { id } = req.params as { id: string };
      const repair = await createExternalRepair(
        app.prisma,
        id,
        parsed.data,
        getUserId(req)
      );
      return reply.status(201).send(repair);
    }
  );

  app.get(
    "/jobs/:id/external-repairs",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        tags: ["jobs"],
        summary: "List external repairs for a job",
        params: jobParams,
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      return await listExternalRepairs(app.prisma, id);
    }
  );

  // Active supplier names for the send dialog — FRONT_DESK lacks
  // parts:viewCatalog, so /suppliers would 403 for the roles that
  // actually register external repairs. Names only, no catalog data.
  app.get(
    "/external-repairs/suppliers",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        tags: ["jobs"],
        summary: "List active suppliers for external repair picker",
      },
    },
    async (_req, reply) => {
      const suppliers = await app.prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return reply.send({ data: suppliers });
    }
  );

  app.post(
    "/external-repairs/:repairId/return",
    {
      preHandler: [requirePermission({ jobs: ["edit"] })],
      schema: {
        tags: ["jobs"],
        summary: "Mark external repair as returned",
        params: repairParams,
      },
    },
    async (req) => {
      const parsed = externalRepairReturnSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const { repairId } = req.params as { repairId: string };
      return await returnExternalRepair(app.prisma, repairId, parsed.data);
    }
  );

  app.post(
    "/external-repairs/:repairId/cancel",
    {
      preHandler: [requirePermission({ jobs: ["edit"] })],
      schema: {
        tags: ["jobs"],
        summary: "Cancel an external repair",
        params: repairParams,
      },
    },
    async (req) => {
      const { repairId } = req.params as { repairId: string };
      return await cancelExternalRepair(app.prisma, repairId);
    }
  );

  done();
};
