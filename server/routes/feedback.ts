import { AppError } from "@shared/errors/app-error.js";
import { reportProblemSchema } from "@shared/schemas/feedback.schema";
import type { FastifyPluginAsync } from "fastify";
import { submitFeedbackReport } from "../services/feedback.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/report",
    {
      schema: {
        tags: ["feedback"],
        summary: "Submit an in-app problem report",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      if (!req.user) {
        throw new AppError("UNAUTHORIZED");
      }
      const parsed = reportProblemSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await submitFeedbackReport(parsed.data, {
        name: req.user.name,
        username: req.user.username,
      });
      return reply.send(result);
    }
  );
};
