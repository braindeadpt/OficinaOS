import { IntakeRequestStatus } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import { convertIntakeRequestSchema } from "@shared/schemas/intake-request.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  convertIntakeRequest,
  dismissIntakeRequest,
  generateIntakeAiReport,
  listIntakeRequests,
} from "../services/intake-request.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const STATUS_VALUES = new Set<string>(Object.values(IntakeRequestStatus));

// Staff-facing queue for the public pre-check form. Convert links the request
// to a job created through the normal intake modal — never creates jobs here.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const intakeRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        querystring: {
          properties: { status: { type: "string" } },
          type: "object",
        },
        summary: "List intake requests",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { status } = req.query as { status?: string };
      if (status && !STATUS_VALUES.has(status)) {
        throw new AppError("VALIDATION_ERROR");
      }
      const requests = await listIntakeRequests(
        app.prisma,
        status as keyof typeof IntakeRequestStatus | undefined
      );
      return reply.send(requests);
    }
  );

  app.post(
    "/:id/dismiss",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Dismiss a pending intake request",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await dismissIntakeRequest(app.prisma, id);
      return reply.send(request);
    }
  );

  app.post(
    "/:id/convert",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        body: {
          properties: { jobId: { type: "string" } },
          required: ["jobId"],
          type: "object",
        },
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Link an intake request to its new job",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = convertIntakeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const request = await convertIntakeRequest(
        app.prisma,
        id,
        parsed.data.jobId
      );
      return reply.send(request);
    }
  );

  // Shop-side Pro action: cloud generates the AI report with OUR paired token
  // (ai-reports module) — the customer never needs a token.
  app.post(
    "/:id/ai-report",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Generate the AI diagnostic report via OficinaOS Cloud",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await generateIntakeAiReport(app.prisma, id, req.locale);
      return reply.send(request);
    }
  );
};
