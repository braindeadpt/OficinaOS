import { AppError } from "@shared/errors/app-error.js";
import {
  createLoanerDeviceSchema,
  updateLoanerDeviceSchema,
} from "@shared/schemas/loaner.schema.js";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  createLoanerDevice,
  listLoanerDevices,
  markLoanerReturned,
  updateLoanerDevice,
} from "../services/loaner.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const idParams = {
  properties: { id: { type: "string" } },
  required: ["id"],
  type: "object",
} as const;

// Shop loaner fleet — which units exist, which are out, and the return stamp.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const loanersRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [requirePermission({ loaners: ["view"] })],
      schema: {
        summary: "List loaner devices with derived availability",
        tags: ["loaners"],
      },
    },
    async (_req, reply) => reply.send(await listLoanerDevices(app.prisma))
  );

  app.post(
    "/",
    {
      preHandler: [requirePermission({ loaners: ["manage"] })],
      schema: {
        body: { additionalProperties: true, type: "object" },
        summary: "Register a loaner unit",
        tags: ["loaners"],
      },
    },
    async (req, reply) => {
      const parsed = createLoanerDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const device = await createLoanerDevice(app.prisma, parsed.data);
      return reply.status(201).send(device);
    }
  );

  app.patch(
    "/:id",
    {
      preHandler: [requirePermission({ loaners: ["manage"] })],
      schema: {
        body: { additionalProperties: true, type: "object" },
        params: idParams,
        summary: "Edit a loaner unit (also retire/reactivate)",
        tags: ["loaners"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateLoanerDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      return reply.send(await updateLoanerDevice(app.prisma, id, parsed.data));
    }
  );

  app.post(
    "/:id/return",
    {
      preHandler: [requirePermission({ loaners: ["return"] })],
      schema: {
        params: idParams,
        summary: "Stamp the unit as physically returned by the customer",
        tags: ["loaners"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return reply.send(
        await markLoanerReturned(app.prisma, id, getUserId(req))
      );
    }
  );
};
