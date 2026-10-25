import { AuditAction } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  importJobsSchema,
  importPartsSchema,
  importRepairsSchema,
} from "@shared/schemas/data-io.schema";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { DEMO_IMPORT_MAX_ROWS, isDemoMode } from "../lib/demo.js";
import { requirePermission } from "../middlewares/rbac.js";
import { createAuditLog } from "../services/audit.service.js";
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

// Bulk import/export moves personal data in both directions — OWNER only.
const dataIoPermission = requirePermission({ settings: ["edit"] });

// Import bodies can be large (≤1000 rows of JSON per chunk); 5 MB is the cap.
const IMPORT_BODY_LIMIT = 5 * 1024 * 1024;

function csvReply(reply: FastifyReply, name: string, csv: string) {
  return reply
    .header("Content-Disposition", `attachment; filename="${name}.csv"`)
    .type("text/csv; charset=utf-8")
    .send(csv);
}

function parseImportBody(
  schema: typeof importPartsSchema,
  req: FastifyRequest
) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", {
      errors: resolveZodErrors(parsed.error.flatten().fieldErrors, req.locale),
    });
  }
  const rows = parsed.data.rows;
  // Demo: small imports are allowed, bulk imports are not — the shared
  // dataset would be churned by whoever pastes in a spreadsheet.
  if (isDemoMode() && rows.length > DEMO_IMPORT_MAX_ROWS) {
    throw new AppError("DEMO_DISABLED");
  }
  return rows;
}

// Import/export em massa — CSV/XLSX (o XLSX é convertido no cliente para
// JSON antes do POST; o servidor só aceita o payload validado).
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const dataIoRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/export/jobs.csv",
    { preHandler: dataIoPermission },
    async (req, reply) => {
      const { csv, rows } = await exportJobsCsv(app.prisma);
      await createAuditLog(app.prisma, {
        action: AuditAction.DATA_EXPORTED,
        jobId: null,
        metadata: { entity: "jobs", rows },
        userId: getUserId(req),
      });
      return csvReply(reply, "reparacoes", csv);
    }
  );

  app.get(
    "/export/parts.csv",
    { preHandler: dataIoPermission },
    async (req, reply) => {
      const { csv, rows } = await exportPartsCsv(app.prisma);
      await createAuditLog(app.prisma, {
        action: AuditAction.DATA_EXPORTED,
        jobId: null,
        metadata: { entity: "parts", rows },
        userId: getUserId(req),
      });
      return csvReply(reply, "pecas", csv);
    }
  );

  app.get(
    "/export/repairs.csv",
    { preHandler: dataIoPermission },
    async (req, reply) => {
      const { csv, rows } = await exportRepairsCsv(app.prisma);
      await createAuditLog(app.prisma, {
        action: AuditAction.DATA_EXPORTED,
        jobId: null,
        metadata: { entity: "repairs", rows },
        userId: getUserId(req),
      });
      return csvReply(reply, "servicos", csv);
    }
  );

  app.post(
    "/import/parts",
    { bodyLimit: IMPORT_BODY_LIMIT, preHandler: dataIoPermission },
    async (req, reply) => {
      const rows = parseImportBody(importPartsSchema, req);
      const summary = await importParts(
        app.prisma,
        rows,
        getUserId(req),
        req.locale
      );
      await createAuditLog(app.prisma, {
        action: AuditAction.DATA_IMPORTED,
        jobId: null,
        metadata: {
          entity: "parts",
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors.length,
        },
        userId: getUserId(req),
      });
      return reply.send(summary);
    }
  );

  app.post(
    "/import/repairs",
    { bodyLimit: IMPORT_BODY_LIMIT, preHandler: dataIoPermission },
    async (req, reply) => {
      const rows = parseImportBody(importRepairsSchema, req);
      const summary = await importRepairs(app.prisma, rows, req.locale);
      await createAuditLog(app.prisma, {
        action: AuditAction.DATA_IMPORTED,
        jobId: null,
        metadata: {
          entity: "repairs",
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors.length,
        },
        userId: getUserId(req),
      });
      return reply.send(summary);
    }
  );

  app.post(
    "/import/jobs",
    { bodyLimit: IMPORT_BODY_LIMIT, preHandler: dataIoPermission },
    async (req, reply) => {
      const rows = parseImportBody(importJobsSchema, req);
      const summary = await importJobs(
        app.prisma,
        rows,
        getUserId(req),
        req.locale
      );
      await createAuditLog(app.prisma, {
        action: AuditAction.DATA_IMPORTED,
        jobId: null,
        metadata: {
          entity: "jobs",
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors.length,
        },
        userId: getUserId(req),
      });
      return reply.send(summary);
    }
  );
};
