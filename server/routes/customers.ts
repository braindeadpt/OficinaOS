import { AppError } from "@shared/errors/app-error.js";
import {
  createCustomerSchema,
  customerIdParamSchema,
  customerListQuerySchema,
  customerSearchQuerySchema,
  updateCustomerSchema,
} from "@shared/schemas/customer.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  findDuplicateGroups,
  mergeCustomers,
  previewMerge,
} from "../services/customer-duplicates.service.js";
import {
  create as createCustomer,
  getById,
  list as listCustomers,
  search as searchCustomers,
  update as updateCustomer,
} from "../services/customers.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const customersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ customers: ["view"] }));

  // Possíveis duplicados por número normalizado E.164 (issue #77) —
  // relatório informativo; a junção é manual, par a par, com auditoria.
  app.get(
    "/duplicates",
    {
      schema: {
        tags: ["customers"],
        summary: "List possible duplicate customers by normalized phone",
      },
    },
    async (_req, reply) => {
      const groups = await findDuplicateGroups(app.prisma);
      return reply.send({ groups });
    }
  );

  app.post(
    "/merge/preview",
    {
      schema: {
        tags: ["customers"],
        summary: "Preview a pairwise customer merge",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const body = req.body as { keepId?: string; mergedId?: string };
      if (!(body.keepId && body.mergedId)) {
        throw new AppError("VALIDATION_ERROR", {
          message: "keepId e mergedId são obrigatórios",
        });
      }
      const preview = await previewMerge(
        app.prisma,
        body.keepId,
        body.mergedId
      );
      return reply.send(preview);
    }
  );

  app.post(
    "/merge",
    {
      schema: {
        tags: ["customers"],
        summary: "Merge a duplicate customer pair, with audit",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const body = req.body as { keepId?: string; mergedId?: string };
      if (!(body.keepId && body.mergedId)) {
        throw new AppError("VALIDATION_ERROR", {
          message: "keepId e mergedId são obrigatórios",
        });
      }
      if (!req.user) {
        throw new AppError("UNAUTHORIZED");
      }
      const result = await mergeCustomers(
        app.prisma,
        body.keepId,
        body.mergedId,
        req.user.id
      );
      return reply.send(result);
    }
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["customers"],
        summary: "Create customer",
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ customers: ["create"] })],
    },
    async (req, reply) => {
      const parsed = createCustomerSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const customer = await createCustomer(app.prisma, parsed.data);
      return reply.status(201).send(customer);
    }
  );

  app.patch(
    "/:id",
    {
      schema: {
        tags: ["customers"],
        summary: "Update customer",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ customers: ["edit"] })],
    },
    async (req, reply) => {
      const parsed = updateCustomerSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const { id } = req.params as { id: string };
      const updated = await updateCustomer(app.prisma, id, parsed.data);
      if (!updated) {
        throw new AppError("CUSTOMER_NOT_FOUND");
      }
      return reply.send(updated);
    }
  );

  app.get(
    "/search",
    {
      schema: {
        tags: ["customers"],
        summary: "Search customers",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = customerSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const results = await searchCustomers(app.prisma, parsed.data);
      return reply.send(results);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["customers"],
        summary: "Get customer by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = customerIdParamSchema.safeParse(id);
      if (!parsed.success) {
        throw new AppError("INVALID_CUSTOMER_ID");
      }
      const customer = await getById(app.prisma, id);
      if (!customer) {
        throw new AppError("CUSTOMER_NOT_FOUND");
      }
      return reply.send(customer);
    }
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["customers"],
        summary: "List customers",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = customerListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await listCustomers(app.prisma, parsed.data);
      return reply.send(result);
    }
  );
};
