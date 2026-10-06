import { AppError } from "@shared/errors/app-error.js";
import { changePasswordSchema } from "@shared/schemas/auth.schema";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsync } from "fastify";
import { changePassword as changePasswordService } from "../services/auth.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async signature
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/auth/change-password",
    {
      schema: {
        tags: ["auth"],
        summary: "Change password",
        body: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
            username: { type: "string", minLength: 3, maxLength: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const headers = fromNodeHeaders(request.headers);
      const session = await app.auth.api.getSession({ headers });

      if (!session?.user) {
        throw new AppError("UNAUTHORIZED");
      }

      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }

      const { oldPassword, newPassword, username } = parsed.data;

      const result = await changePasswordService(
        app.prisma,
        session.user.id,
        oldPassword,
        newPassword,
        username,
        session.session.id
      );

      return reply.send(result);
    }
  );

  app.get(
    "/api/auth/must-change-password",
    {
      schema: {
        tags: ["auth"],
        summary: "Check if user must change password",
      },
    },
    async (request, reply) => {
      const headers = fromNodeHeaders(request.headers);
      const session = await app.auth.api.getSession({ headers });

      if (!session?.user) {
        throw new AppError("UNAUTHORIZED");
      }
      return reply.send({
        mustChangePassword: session.user.mustChangePassword,
      });
    }
  );
};
