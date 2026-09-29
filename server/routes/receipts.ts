import { AppError } from "@shared/errors/app-error.js";
import { jobIdParamSchema } from "@shared/schemas/receipt.schema";
import type { FastifyPluginAsync } from "fastify";
import { resolveUrls } from "../config/env.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getById as getJobById } from "../services/job.service.js";
import {
  renderLabelHtml,
  renderReceiptHtml,
} from "../services/receipt.service.js";
import { getRole } from "../utils/request.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const receiptRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/:id/receipt",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        tags: ["receipts"],
        summary: "Get receipt HTML",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const paramParsed = jobIdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      const { id } = paramParsed.data;
      const job = await getJobById(app.prisma, id);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND");
      }

      const { appUrl: baseUrl } = resolveUrls();
      if (!baseUrl) {
        app.log.warn(
          "APP_URL is not set — receipt QR and tracking link will not work"
        );
      }

      const costPerm = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { parts: ["viewCost"] },
        },
      });
      const html = await renderReceiptHtml(
        app.prisma,
        job as unknown as Parameters<typeof renderReceiptHtml>[1],
        baseUrl,
        {
          hideCosts: !costPerm.success,
          locale: req.locale,
        }
      );

      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(html);
    }
  );

  app.get(
    "/:id/label",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        tags: ["receipts"],
        summary: "Get label HTML",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            preview: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const paramParsed = jobIdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      const { id } = paramParsed.data;
      const job = await getJobById(app.prisma, id);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND");
      }

      const { appUrl: baseUrl } = resolveUrls();
      if (!baseUrl) {
        app.log.warn(
          "APP_URL is not set — label QR and tracking link will not work"
        );
      }

      const costPerm = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { parts: ["viewCost"] },
        },
      });
      const isPreview = (req.query as { preview?: string }).preview === "1";
      const html = await renderLabelHtml(
        app.prisma,
        job as unknown as Parameters<typeof renderLabelHtml>[1],
        baseUrl,
        {
          hideCosts: !costPerm.success,
          locale: req.locale,
          noAutoPrint: isPreview,
        }
      );

      const cspDirectives = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        isPreview ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");

      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", cspDirectives)
        .send(html);
    }
  );
};
