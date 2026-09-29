import { AppError } from "@shared/errors/app-error.js";
import {
  createPartSchema,
  createStockMovementSchema,
  listPartsQuerySchema,
  togglePartStatusSchema,
  updatePartSchema,
} from "@shared/schemas/parts-catalog.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  create as createPart,
  remove as deletePart,
  getById as getPartById,
  list as listParts,
  toggleActive,
  update as updatePart,
} from "../services/parts-catalog.service.js";
import { restockForecast } from "../services/restock-forecast.service.js";
import {
  listMovementsQuerySchema,
  listByPart as listStockMovements,
  recordAdjustment,
  recordPurchase,
} from "../services/stock-movement.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const partsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ parts: ["viewCatalog"] }));

  app.get(
    "/",
    {
      schema: {
        tags: ["parts"],
        summary: "List parts",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = listPartsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await listParts(app.prisma, parsed.data);
      return reply.send(result);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["parts"],
        summary: "Get part by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const part = await getPartById(app.prisma, id);
      if (!part) {
        throw new AppError("PART_NOT_FOUND");
      }
      return reply.send(part);
    }
  );

  app.post(
    "/",
    {
      preHandler: [requirePermission({ parts: ["manageCatalog"] })],
      schema: {
        tags: ["parts"],
        summary: "Create part",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = createPartSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const part = await createPart(app.prisma, parsed.data);
      return reply.status(201).send(part);
    }
  );

  app.patch(
    "/:id",
    {
      preHandler: [requirePermission({ parts: ["manageCatalog"] })],
      schema: {
        tags: ["parts"],
        summary: "Update part",
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
      const parsed = updatePartSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await updatePart(app.prisma, id, parsed.data);
      if (!result) {
        throw new AppError("PART_NOT_FOUND");
      }
      return reply.send(result);
    }
  );

  app.patch(
    "/:id/status",
    {
      preHandler: [requirePermission({ parts: ["manageCatalog"] })],
      schema: {
        tags: ["parts"],
        summary: "Toggle part status",
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
      const parsed = togglePartStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await toggleActive(app.prisma, id, parsed.data.isActive);
      if (!result) {
        throw new AppError("PART_NOT_FOUND");
      }
      return reply.send(result);
    }
  );

  app.post(
    "/:id/stock-movements",
    {
      preHandler: [requirePermission({ parts: ["manageCatalog"] })],
      schema: {
        tags: ["parts"],
        summary: "Record a manual stock movement (purchase or adjustment)",
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
      const parsed = createStockMovementSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const { intent } = req.body as { intent?: string };

      const result =
        intent === "ADJUSTMENT"
          ? await recordAdjustment(app.prisma, id, parsed.data, userId)
          : await recordPurchase(app.prisma, id, parsed.data, userId);

      if (!result) {
        throw new AppError("PART_NOT_FOUND");
      }
      return reply.status(201).send(result);
    }
  );

  app.get(
    "/restock-forecast",
    {
      schema: {
        tags: ["parts"],
        summary:
          "Restock forecast: days-until-empty and suggested purchase quantity per part",
      },
    },
    async () => restockForecast(app.prisma)
  );

  app.get(
    "/:id/stock-movements",
    {
      schema: {
        tags: ["parts"],
        summary: "Stock movement history for a part",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = listMovementsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      const result = await listStockMovements(app.prisma, id, parsed.data);
      return reply.send(result);
    }
  );

  app.delete(
    "/:id",
    {
      preHandler: [requirePermission({ parts: ["manageCatalog"] })],
      schema: {
        tags: ["parts"],
        summary: "Delete part",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await deletePart(app.prisma, id);
      if (!result) {
        throw new AppError("PART_NOT_FOUND");
      }
      return reply.status(204).send();
    }
  );
};
