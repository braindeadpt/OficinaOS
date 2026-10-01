import { Role } from "@shared/constants/roles";
import { AppError, throwIfError } from "@shared/errors/app-error.js";
import {
  addJobNoteSchema,
  addJobPartSchema,
  addJobRepairSchema,
  addWaitingPartSchema,
  createJobSchema,
  jobListQuerySchema,
  transitionStatusSchema,
  updateJobSchema,
} from "@shared/schemas/job.schema";
import { paymentOnDeliverySchema } from "@shared/schemas/payment.schema";
import { sendQuoteSchema } from "@shared/schemas/quote.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  computeMargin,
  create as createJob,
  getById as getJobById,
  getJobHistory,
  getMetrics,
  list as listJobs,
  lookupByCode,
  lookupByCodeAuth,
  transitionStatus,
  update as updateJob,
} from "../services/job.service.js";
import {
  add as addNote,
  list as listNotes,
} from "../services/job-notes.service.js";
import {
  add as addPart,
  remove as removePart,
} from "../services/job-parts.service.js";
import {
  remove as removePhoto,
  upload as uploadPhoto,
} from "../services/job-photos.service.js";
import {
  createAndSendQuote,
  listQuotes,
} from "../services/job-quote.service.js";
import {
  add as addRepair,
  remove as removeRepair,
} from "../services/job-repairs.service.js";
import {
  add as addWaitingPart,
  remove as removeWaitingPart,
} from "../services/job-waiting-parts.service.js";
import { notify } from "../services/notification-dispatch.js";
import {
  clearPaymentOnDelivery,
  setPaymentOnDelivery,
} from "../services/payment.service.js";
import { codeLockout } from "../utils/code-lockout.js";
import { getRole, getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const JOB_CODE_RE = /^[A-Za-z0-9-]+$/;
const PHONE4_RE = /^\d{4}$/;

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ jobs: ["view"] }));

  // Public: no auth — used by customer self-tracking page.
  // `config.public` is what actually bypasses the requirePermission hook
  // (a `preHandler: []` route option cannot remove plugin-level hooks).
  // Rate limit lives in config/route-security.ts (10 per 15 min, per IP).
  app.get("/lookup", {
    schema: {
      tags: ["jobs"],
      summary: "Public job lookup by code + phone4",
      querystring: {
        type: "object",
        required: ["code", "phone4"],
        properties: {
          code: { type: "string" },
          phone4: { type: "string" },
        },
      },
    },
    config: { public: true },
    handler: async (req, reply) => {
      const { code, phone4 } = req.query as {
        code?: string;
        phone4?: string;
      };
      if (!(code && phone4)) {
        throw new AppError("MISSING_LOOKUP_PARAMS");
      }
      if (code.length > 50 || !JOB_CODE_RE.test(code)) {
        throw new AppError("INVALID_JOB_CODE");
      }
      if (!PHONE4_RE.test(phone4)) {
        throw new AppError("INVALID_PHONE4");
      }

      // After validation, code and phone4 are guaranteed to exist
      // biome-ignore lint/style/noNonNullAssertion: validated above
      const codeStr = code!;
      // biome-ignore lint/style/noNonNullAssertion: validated above
      const phone4Str = phone4!;

      if (codeLockout.isLocked(codeStr)) {
        throw new AppError("JOB_NOT_FOUND");
      }

      const result = await lookupByCode(app.prisma, codeStr, phone4Str);
      if (!result.jobExists) {
        throw new AppError("JOB_NOT_FOUND");
      }
      if (!result.job) {
        codeLockout.trackFailure(codeStr);
        throw new AppError("JOB_NOT_FOUND");
      }

      codeLockout.clear(codeStr);
      return reply.send(result.job);
    },
  });

  app.get(
    "/by-code/:jobCode",
    {
      schema: {
        tags: ["jobs"],
        summary: "Get job by code (authenticated)",
        params: {
          type: "object",
          properties: { jobCode: { type: "string" } },
          required: ["jobCode"],
        },
      },
    },
    async (req, reply) => {
      const { jobCode } = req.params as { jobCode: string };
      const job = await lookupByCodeAuth(app.prisma, jobCode);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND");
      }
      return reply.send(job);
    }
  );

  app.get(
    "/metrics",
    {
      schema: {
        tags: ["jobs"],
        summary: "Job metrics",
      },
    },
    async (_req, reply) => {
      const metrics = await getMetrics(app.prisma);
      return reply.send(metrics);
    }
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["jobs"],
        summary: "List jobs",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = jobListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await listJobs(app.prisma, parsed.data);
      return reply.send(result);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["jobs"],
        summary: "Get job by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const job = await getJobById(app.prisma, id);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND");
      }
      const marginResult = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { reports: ["viewMargin"] },
        },
      });
      if (marginResult.success) {
        const margin = computeMargin(job);
        return reply.send({ ...job, margin });
      }
      return reply.send(job);
    }
  );

  app.get(
    "/:id/history",
    {
      schema: {
        tags: ["jobs"],
        summary: "Get job audit history",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const job = await getJobById(app.prisma, id);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND");
      }
      const entries = await getJobHistory(app.prisma, id);
      return reply.send(entries);
    }
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["jobs"],
        summary: "Create job",
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["create"] })],
    },
    async (req, reply) => {
      const parsed = createJobSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const notifyCtx = { prisma: app.prisma, wsBroadcast: app.wsBroadcast };
      const result = await createJob(
        app.prisma,
        parsed.data,
        userId,
        notifyCtx
      );
      throwIfError(result);

      if (
        "isWarrantyReturn" in result &&
        result.isWarrantyReturn &&
        "jobCode" in result
      ) {
        const customer =
          "customer" in result ? (result.customer ?? null) : null;
        notify(notifyCtx, {
          context: customer
            ? {
                customerName: customer.name,
                jobCode: result.jobCode,
                // Enables consent-gated WhatsApp delivery to the
                // customer alongside the in-app owner alert.
                recipientPhone: customer.phone,
              }
            : { jobCode: result.jobCode },
          eventName: "warranty_return_created",
          jobId: result.id,
          recipients: { role: Role.OWNER },
        }).catch(() => {
          /* fire-and-forget */
        });
      }

      return reply.status(201).send(result);
    }
  );

  app.patch(
    "/:id",
    {
      schema: {
        tags: ["jobs"],
        summary: "Update job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateJobSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await updateJob(app.prisma, id, parsed.data, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.send(result);
    }
  );

  app.patch(
    "/:id/status",
    {
      schema: {
        tags: ["jobs"],
        summary: "Transition job status",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = transitionStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }

      const permCheck = await app.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { jobStatus: [parsed.data.status] },
        },
      });
      if (!permCheck.success) {
        throw new AppError("FORBIDDEN_STATUS_TRANSITION");
      }

      const userId = getUserId(req);
      const notifyCtx = { prisma: app.prisma, wsBroadcast: app.wsBroadcast };
      const result = await transitionStatus(
        app.prisma,
        id,
        parsed.data.status,
        userId,
        notifyCtx,
        {
          requestingRole: getRole(req),
          reason: parsed.data.reason,
          actualLaborHours: parsed.data.actualLaborHours ?? undefined,
        }
      );
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      if ("error" in result && result.error === "CONFLICT_STATUS_TRANSITION") {
        throw new AppError("CONFLICT_STATUS_TRANSITION", {
          allowedTransitions: result.allowedTransitions,
          currentStatus: result.currentStatus,
        });
      }
      throwIfError(result);
      return reply.send(result);
    }
  );

  // ── Paid-on-delivery (one click) ──
  app.post(
    "/:id/payment-on-delivery",
    {
      schema: {
        tags: ["jobs"],
        summary:
          "Mark job as paid-on-delivery with a chosen method; payment auto-records at DELIVERED",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ payments: ["create"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = paymentOnDeliverySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await setPaymentOnDelivery(
        app.prisma,
        id,
        parsed.data.method,
        userId
      );
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/payment-on-delivery",
    {
      schema: {
        tags: ["jobs"],
        summary: "Clear the paid-on-delivery mark on a job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ payments: ["delete"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = getUserId(req);
      const result = await clearPaymentOnDelivery(app.prisma, id, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.status(204).send();
    }
  );

  // ── Quotes ──
  app.get(
    "/:id/quotes",
    {
      schema: {
        tags: ["jobs"],
        summary: "List quotes sent for a job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const quotes = await listQuotes(app.prisma, id);
      if (!quotes) {
        throw new AppError("JOB_NOT_FOUND");
      }
      return reply.send(quotes);
    }
  );

  app.post(
    "/:id/quotes",
    {
      schema: {
        tags: ["jobs"],
        summary: "Create and send a quote to the customer",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = sendQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const quote = await createAndSendQuote(
        app.prisma,
        id,
        parsed.data,
        userId,
        { prisma: app.prisma, wsBroadcast: app.wsBroadcast }
      );
      if (!quote) {
        throw new AppError("JOB_NOT_FOUND");
      }
      return reply.status(201).send(quote);
    }
  );

  app.get(
    "/:id/notes",
    {
      schema: {
        tags: ["jobs"],
        summary: "List job notes",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const notes = await listNotes(app.prisma, id);
      if (!notes) {
        throw new AppError("JOB_NOT_FOUND");
      }
      return reply.send(notes);
    }
  );

  app.post(
    "/:id/notes",
    {
      schema: {
        tags: ["jobs"],
        summary: "Add job note",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addJobNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const note = await addNote(app.prisma, id, parsed.data, userId);
      if (!note) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(note);
      return reply.status(201).send(note);
    }
  );

  app.post(
    "/:id/parts",
    {
      schema: {
        tags: ["jobs"],
        summary: "Add part to job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addJobPartSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await addPart(app.prisma, id, parsed.data, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/parts/:partId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Remove part from job",
        params: {
          type: "object",
          properties: { id: { type: "string" }, partId: { type: "string" } },
          required: ["id", "partId"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id, partId } = req.params as { id: string; partId: string };
      const userId = getUserId(req);
      const removed = await removePart(app.prisma, id, partId, userId);
      if (!removed) {
        throw new AppError("RESOURCE_NOT_FOUND");
      }
      return reply.status(204).send();
    }
  );

  app.post(
    "/:id/repairs",
    {
      schema: {
        tags: ["jobs"],
        summary: "Add repair to job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addJobRepairSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await addRepair(app.prisma, id, parsed.data, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/repairs/:repairId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Remove repair from job",
        params: {
          type: "object",
          properties: { id: { type: "string" }, repairId: { type: "string" } },
          required: ["id", "repairId"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id, repairId } = req.params as { id: string; repairId: string };
      const userId = getUserId(req);
      const removed = await removeRepair(app.prisma, id, repairId, userId);
      if (!removed) {
        throw new AppError("RESOURCE_NOT_FOUND");
      }
      return reply.status(204).send();
    }
  );

  app.post(
    "/:id/photos",
    {
      schema: {
        tags: ["jobs"],
        summary: "Upload job photo",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        consumes: ["multipart/form-data"],
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const data = await req.file();
      if (!data) {
        throw new AppError("NO_FILE_UPLOADED");
      }
      const userId = getUserId(req);
      const result = await uploadPhoto(app.prisma, id, data, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/photos/:photoId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Delete job photo",
        params: {
          type: "object",
          properties: { id: { type: "string" }, photoId: { type: "string" } },
          required: ["id", "photoId"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id, photoId } = req.params as { id: string; photoId: string };
      const userId = getUserId(req);
      const removed = await removePhoto(app.prisma, id, photoId, userId);
      if (!removed) {
        throw new AppError("RESOURCE_NOT_FOUND");
      }
      return reply.status(204).send();
    }
  );

  app.post(
    "/:id/waiting-parts",
    {
      schema: {
        tags: ["jobs"],
        summary: "Add waiting part",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addWaitingPartSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await addWaitingPart(app.prisma, id, parsed.data, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/waiting-parts/:waitingId",
    {
      schema: {
        tags: ["jobs"],
        summary: "Remove waiting part",
        params: {
          type: "object",
          properties: { id: { type: "string" }, waitingId: { type: "string" } },
          required: ["id", "waitingId"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id, waitingId } = req.params as { id: string; waitingId: string };
      const userId = getUserId(req);
      const removed = await removeWaitingPart(
        app.prisma,
        id,
        waitingId,
        userId
      );
      if (!removed) {
        throw new AppError("RESOURCE_NOT_FOUND");
      }
      return reply.status(204).send();
    }
  );
};
