import { AppError, throwIfError } from "@shared/errors/app-error.js";
import { addPaymentSchema } from "@shared/schemas/payment.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  add as addPayment,
  listForJob,
  remove as removePayment,
} from "../services/payment.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ jobs: ["view"] }));

  app.get(
    "/:id/payments",
    {
      schema: {
        tags: ["payments"],
        summary: "List payments and paid total for a job",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await listForJob(app.prisma, id);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      return reply.send(result);
    }
  );

  app.post(
    "/:id/payments",
    {
      schema: {
        tags: ["payments"],
        summary: "Record a payment (partial or full) for a job",
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
      const parsed = addPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await addPayment(app.prisma, id, parsed.data, userId);
      if (!result) {
        throw new AppError("JOB_NOT_FOUND");
      }
      if ("error" in result && result.error === "PAYMENT_EXCEEDS_BALANCE") {
        throw new AppError("PAYMENT_EXCEEDS_BALANCE", {
          balanceDue: result.balanceDue,
        });
      }
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/payments/:paymentId",
    {
      schema: {
        tags: ["payments"],
        summary: "Remove a payment from a job",
        params: {
          type: "object",
          properties: { id: { type: "string" }, paymentId: { type: "string" } },
          required: ["id", "paymentId"],
        },
      },
      preHandler: [requirePermission({ payments: ["delete"] })],
    },
    async (req, reply) => {
      const { id, paymentId } = req.params as {
        id: string;
        paymentId: string;
      };
      const userId = getUserId(req);
      const result = await removePayment(app.prisma, id, paymentId, userId);
      throwIfError(result);
      return reply.status(204).send();
    }
  );
};
