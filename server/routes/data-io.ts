import { AppError } from "@shared/errors/app-error.js";
import {
  importJobsSchema,
  importPartsSchema,
  importRepairsSchema,
} from "@shared/schemas/data-io.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  exportJobsCsv,
  exportPartsCsv,
  exportRepairsCsv,
  importJobs,
  importParts,
  importRepairs,
} from "../services/data-io.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

function csvReply(
  reply: import("fastify").FastifyReply,
  name: string,
  csv: string
) {
  return reply
    .header("Content-Disposition", `attachment; filename="${name}.csv"`)
    .type("text/csv; charset=utf-8")
    .send(csv);
}

// Import/export em massa — CSV/XLSX (o XLSX é convertido no cliente para
// JSON antes do POST; o servidor só aceita o payload validado).
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const dataIoRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/export/jobs.csv",
    { preHandler: requirePermission({ jobs: ["view"] }) },
    async (_req, reply) =>
      csvReply(reply, "reparacoes", await exportJobsCsv(app.prisma))
  );

  app.get(
    "/export/parts.csv",
    { preHandler: requirePermission({ parts: ["viewCatalog"] }) },
    async (_req, reply) =>
      csvReply(reply, "pecas", await exportPartsCsv(app.prisma))
  );

  app.get(
    "/export/repairs.csv",
    { preHandler: requirePermission({ repairs: ["viewCatalog"] }) },
    async (_req, reply) =>
      csvReply(reply, "servicos", await exportRepairsCsv(app.prisma))
  );

  app.post(
    "/import/parts",
    { preHandler: requirePermission({ parts: ["manageCatalog"] }) },
    async (req, reply) => {
      const parsed = importPartsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      return reply.send(await importParts(app.prisma, parsed.data.rows));
    }
  );

  app.post(
    "/import/repairs",
    { preHandler: requirePermission({ repairs: ["manageCatalog"] }) },
    async (req, reply) => {
      const parsed = importRepairsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      return reply.send(await importRepairs(app.prisma, parsed.data.rows));
    }
  );

  app.post(
    "/import/jobs",
    { preHandler: requirePermission({ jobs: ["create"] }) },
    async (req, reply) => {
      const parsed = importJobsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      return reply.send(
        await importJobs(app.prisma, parsed.data.rows, getUserId(req))
      );
    }
  );
};
