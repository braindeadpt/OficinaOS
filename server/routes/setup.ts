import { AppError } from "@shared/errors/app-error.js";
import { setupSchema } from "@shared/schemas/auth.schema";
import type { FastifyPluginAsync } from "fastify";
import { loadEnv } from "../config/env.js";
import {
  createFirstOwner,
  isSetupAllowed,
  isSetupNeeded,
} from "../services/setup.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async signature
export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/api/setup/status",
    {
      schema: {
        tags: ["auth"],
        summary: "First-run setup status",
        querystring: {
          type: "object",
          properties: { token: { type: "string", maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      const needsSetup = await isSetupNeeded(app.prisma);
      if (!needsSetup) {
        return reply.send({ needsSetup: false, allowed: false });
      }
      const { token } = (request.query ?? {}) as { token?: string };
      const allowed = isSetupAllowed(request, token, loadEnv().SETUP_TOKEN);
      return reply.send({ needsSetup: true, allowed });
    }
  );

  app.post(
    "/api/setup",
    {
      schema: {
        tags: ["auth"],
        summary: "Create the shop's first owner (only while no user exists)",
        body: { type: "object" },
      },
    },
    async (request, reply) => {
      // Once any user exists the endpoint does not exist either.
      if (!(await isSetupNeeded(app.prisma))) {
        throw new AppError("NOT_FOUND");
      }

      const body = (request.body ?? {}) as { token?: unknown };
      const token = typeof body.token === "string" ? body.token : undefined;
      if (!isSetupAllowed(request, token, loadEnv().SETUP_TOKEN)) {
        request.log.warn(
          { ip: request.ip },
          "First-run setup refused: not loopback and no valid token"
        );
        throw new AppError("SETUP_NOT_LOCAL");
      }

      const parsed = setupSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }

      const user = await createFirstOwner(app.prisma, parsed.data);
      request.log.info(
        { userId: user.id },
        "First-run setup complete: owner created"
      );

      return reply.status(201).send({
        username: user.username,
        email: user.email,
      });
    }
  );
};
