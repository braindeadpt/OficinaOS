import { LANGUAGES } from "@shared/constants/languages";
import { Role } from "@shared/constants/roles";
import { AppError, throwIfError } from "@shared/errors/app-error.js";
import { loanerAgreementMatches } from "@shared/loaner-agreement-document.js";
import {
  addJobNoteSchema,
  addJobPartSchema,
  addJobRepairSchema,
  addWaitingPartSchema,
  createJobSchema,
  jobListQuerySchema,
  photoStageQuerySchema,
  transitionStatusSchema,
  updateJobSchema,
} from "@shared/schemas/job.schema";
import { paymentOnDeliverySchema } from "@shared/schemas/payment.schema";
import { sendQuoteSchema } from "@shared/schemas/quote.schema";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { resolveUrls } from "../config/env.js";
import { requirePermission } from "../middlewares/rbac.js";
import { issueInvoiceForJob } from "../services/invoicing.service.js";
import {
  type AssignAccess,
  computeMargin,
  create as createJob,
  getById as getJobById,
  getJobHistory,
  getMetrics,
  list as listJobs,
  lookupByCode,
  lookupByCodeAuth,
  lookupReceiptByCode,
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
import {
  attachLoanerSignature,
  createLoanerSignatureSession,
  getLoanerAgreementPreview,
} from "../services/loaner-signature.service.js";
import { notify } from "../services/notification-dispatch.js";
import {
  clearPaymentOnDelivery,
  setPaymentOnDelivery,
} from "../services/payment.service.js";
import {
  publishJobPortal,
  unpublishJobPortal,
} from "../services/portal.service.js";
import { renderReceiptHtml } from "../services/receipt.service.js";
import { createCodeLockout } from "../utils/code-lockout.js";
import { getRole, getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const JOB_CODE_RE = /^[A-Za-z0-9-]+$/;
const PHONE4_RE = /^\d{4}$/;

/** Optional `locale` in a request body — only a supported app language wins. */
function requestedLocale(body: unknown): string | null {
  const locale = (body as { locale?: unknown } | undefined)?.locale;
  return typeof locale === "string" &&
    (LANGUAGES as readonly string[]).includes(locale)
    ? locale
    : null;
}

async function resolveAssignAccess(req: FastifyRequest): Promise<AssignAccess> {
  const role = getRole(req);
  const [assign, selfAssign] = await Promise.all([
    req.server.auth.api.userHasPermission({
      body: { role, permissions: { jobs: ["assign"] } },
    }),
    req.server.auth.api.userHasPermission({
      body: { role, permissions: { jobs: ["selfAssign"] } },
    }),
  ]);
  return { canAssign: assign.success, canSelfAssign: selfAssign.success };
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const jobRoutes: FastifyPluginAsync = async (app) => {
  const codeLockout = createCodeLockout(app.prisma);
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

      if (await codeLockout.isLocked(codeStr)) {
        throw new AppError("JOB_NOT_FOUND");
      }

      const result = await lookupByCode(app.prisma, codeStr, phone4Str);
      if (!result.jobExists) {
        throw new AppError("JOB_NOT_FOUND");
      }
      if (!result.job) {
        await codeLockout.trackFailure(codeStr);
        throw new AppError("JOB_NOT_FOUND");
      }

      await codeLockout.clear(codeStr);
      return reply.send(result.job);
    },
  });

  // Public: customer digital receipt — same code + phone4 proof and the
  // same rate-limit/lockout budget as the lookup endpoint.
  app.get("/lookup-receipt", {
    schema: {
      tags: ["jobs"],
      summary: "Public receipt HTML by code + phone4",
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

      // biome-ignore lint/style/noNonNullAssertion: validated above
      const codeStr = code!;
      // biome-ignore lint/style/noNonNullAssertion: validated above
      const phone4Str = phone4!;

      if (await codeLockout.isLocked(codeStr)) {
        throw new AppError("JOB_NOT_FOUND");
      }

      const result = await lookupReceiptByCode(app.prisma, codeStr, phone4Str);
      if (!result.jobExists) {
        throw new AppError("JOB_NOT_FOUND");
      }
      if (!result.job) {
        await codeLockout.trackFailure(codeStr);
        throw new AppError("JOB_NOT_FOUND");
      }

      await codeLockout.clear(codeStr);
      const { appUrl: baseUrl } = resolveUrls();
      const html = await renderReceiptHtml(
        app.prisma,
        result.job as Parameters<typeof renderReceiptHtml>[1],
        baseUrl,
        {}
      );
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(html);
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
      // A stored signature only counts while the job still produces the
      // document the customer signed — the print applies the same rule, so
      // the badge must not claim "signed" over drifted content.
      const loanerSignatureValid = Boolean(
        job.loanerAgreementSignatureDataUrl &&
          loanerAgreementMatches(job.loanerAgreementSnapshot, job)
      );
      const marginResult = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { reports: ["viewMargin"] },
        },
      });
      if (marginResult.success) {
        const margin = computeMargin(job);
        return reply.send({ ...job, loanerSignatureValid, margin });
      }
      return reply.send({ ...job, loanerSignatureValid });
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
        }).catch((err) => {
          req.log.warn(
            { err, eventName: "warranty_return_created", jobId: result.id },
            "notify dispatch failed"
          );
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
      const assignAccess =
        parsed.data.technicianId === undefined
          ? undefined
          : await resolveAssignAccess(req);
      const result = await updateJob(
        app.prisma,
        id,
        parsed.data,
        userId,
        assignAccess
      );
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
      // A handover payment inside the transition needs the same permission
      // as recording it standalone — status rights alone must not collect money.
      if (parsed.data.payment) {
        const payPerm = await app.auth.api.userHasPermission({
          body: {
            role: getRole(req),
            permissions: { payments: ["create"] },
          },
        });
        if (!payPerm.success) {
          throw new AppError("FORBIDDEN");
        }
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
          loanerReturned: parsed.data.loanerReturned,
          payment: parsed.data.payment,
          requestingRole: getRole(req),
          reason: parsed.data.reason,
          actualLaborHours: parsed.data.actualLaborHours ?? undefined,
          qcChecklist: parsed.data.qcChecklist,
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

  app.post(
    "/:id/invoice",
    {
      schema: {
        tags: ["jobs"],
        summary:
          "Issue the fiscal document (InvoiceXpress) for a repair job — repairs + parts lines",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ payments: ["create"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const issued = await issueInvoiceForJob(app.prisma, id, app.log);
      return reply.status(201).send(issued);
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
      const parsed = photoStageQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      const result = await uploadPhoto(
        app.prisma,
        id,
        data,
        userId,
        parsed.data
      );
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

  // Public portal link — pushes the job's public tracking snapshot to
  // OficinaOS Cloud and returns the shareable URL (module: portal).
  app.post(
    "/:id/portal",
    {
      schema: {
        tags: ["jobs"],
        summary: "Publish public portal link",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await publishJobPortal(app.prisma, id, req.log);
      return reply.send(result);
    }
  );

  app.delete(
    "/:id/portal",
    {
      schema: {
        tags: ["jobs"],
        summary: "Unpublish public portal link",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await unpublishJobPortal(app.prisma, id, req.log);
      return reply.status(204).send();
    }
  );

  // Loaner agreement signing — the term is a separate document from the
  // intake ficha. Creating the session freezes the canonical agreement the
  // server built from the job; attaching moves the signature, document hash
  // and snapshot onto the job once the job still produces that same
  // document (a swapped unit or edited note turns it SIGNATURE_STALE).
  app.post(
    "/:id/loaner-signature-session",
    {
      schema: {
        tags: ["jobs"],
        summary: "Create a signing session for the loaner agreement",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      // The app language wins over the browser's Accept-Language — staff
      // serve customers in the shop's language, not their own.
      const locale = requestedLocale(req.body);
      const result = await createLoanerSignatureSession(
        app.prisma,
        id,
        locale,
        req.log
      );
      return reply.send(result);
    }
  );

  // In-person signing preview — the exact canonical document the customer
  // is about to sign, so the staff screen can show the terms first.
  app.get(
    "/:id/loaner-agreement-preview",
    {
      schema: {
        tags: ["jobs"],
        summary: "Preview the loaner agreement document for a job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const locale = requestedLocale(req.query);
      const preview = await getLoanerAgreementPreview(app.prisma, id, locale);
      return reply.send(preview);
    }
  );

  app.post(
    "/:id/loaner-signature",
    {
      schema: {
        tags: ["jobs"],
        summary: "Attach a signed loaner agreement session to the job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ jobs: ["edit"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as
        | { locale?: unknown; signatureDataUrl?: unknown; token?: unknown }
        | undefined;
      const result = await attachLoanerSignature(
        app.prisma,
        id,
        {
          signatureDataUrl:
            typeof body?.signatureDataUrl === "string"
              ? body.signatureDataUrl
              : undefined,
          token: typeof body?.token === "string" ? body.token : undefined,
        },
        requestedLocale(req.body),
        getUserId(req)
      );
      return reply.send(result);
    }
  );
};
