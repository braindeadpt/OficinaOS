import { AppError } from "@shared/errors/app-error.js";
import {
  createTradeInSchema,
  tradeInStatusSchema,
  updateTradeInSchema,
} from "@shared/schemas/trade-in.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import { renderTradeInReceiptHtml } from "../services/receipt.service.js";
import {
  createTradeIn,
  getTradeIn,
  listTradeIns,
  transitionTradeIn,
  updateTradeIn,
} from "../services/trade-in.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const tradeInsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [requirePermission({ tradeins: ["view"] })],
      schema: {
        querystring: {
          properties: {
            limit: { type: "string" },
            page: { type: "string" },
            status: { type: "string" },
          },
          type: "object",
        },
        summary: "List trade-ins",
        tags: ["trade-ins"],
      },
    },
    async (req, reply) => {
      const q = req.query as {
        limit?: string;
        page?: string;
        status?: string;
      };
      if (q.status) {
        const parsed = tradeInStatusSchema.safeParse(q.status);
        if (!parsed.success) {
          throw new AppError("VALIDATION_ERROR");
        }
      }
      const result = await listTradeIns(app.prisma, {
        limit: q.limit ? Number(q.limit) : undefined,
        page: q.page ? Number(q.page) : undefined,
        status: q.status,
      });
      return reply.send(result);
    }
  );

  app.post(
    "/",
    {
      preHandler: [requirePermission({ tradeins: ["create"] })],
      schema: {
        body: { type: "object", additionalProperties: true },
        summary: "Create trade-in (buy used device from customer)",
        tags: ["trade-ins"],
      },
    },
    async (req, reply) => {
      const parsed = createTradeInSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const tradeIn = await createTradeIn(
        app.prisma,
        parsed.data,
        getUserId(req)
      );
      return reply.status(201).send(tradeIn);
    }
  );

  app.get(
    "/:id",
    {
      preHandler: [requirePermission({ tradeins: ["view"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Get trade-in",
        tags: ["trade-ins"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tradeIn = await getTradeIn(app.prisma, id);
      return reply.send(tradeIn);
    }
  );

  app.patch(
    "/:id",
    {
      preHandler: [requirePermission({ tradeins: ["edit"] })],
      schema: {
        body: { type: "object", additionalProperties: true },
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Update trade-in (OFFERED only)",
        tags: ["trade-ins"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateTradeInSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const tradeIn = await updateTradeIn(app.prisma, id, parsed.data);
      return reply.send(tradeIn);
    }
  );

  app.post(
    "/:id/transition",
    {
      preHandler: [requirePermission({ tradeins: ["edit"] })],
      schema: {
        body: {
          properties: { status: { type: "string" } },
          required: ["status"],
          type: "object",
        },
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Transition trade-in status",
        tags: ["trade-ins"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = tradeInStatusSchema.safeParse(
        (req.body as { status?: unknown })?.status
      );
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      const tradeIn = await transitionTradeIn(app.prisma, id, parsed.data);
      return reply.send(tradeIn);
    }
  );

  // Receipt — the legal purchase record (seller ID + signed declaration).
  app.get(
    "/:id/receipt",
    {
      preHandler: [requirePermission({ tradeins: ["view"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Trade-in receipt HTML",
        tags: ["trade-ins"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tradeIn = await getTradeIn(app.prisma, id);
      const html = await renderTradeInReceiptHtml(app.prisma, tradeIn, {
        locale: req.locale,
      });
      return reply.type("text/html").send(html);
    }
  );
};
