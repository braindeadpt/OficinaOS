import { AppError } from "@shared/errors/app-error.js";
import {
  createReferralSchema,
  updateReferralSchema,
} from "@shared/schemas/referral.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import { create, listForJob, update } from "../services/referrals.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// Forwarding a repair to another shop ("não consigo fazer — encaminho").
// Lives outside the jobs plugin so the permission gates are explicit here.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const referralsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/jobs/:jobId/referrals",
    { preHandler: requirePermission({ jobs: ["view"] }) },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      const referrals = await listForJob(app.prisma, jobId);
      return reply.send({ data: referrals });
    }
  );

  app.post(
    "/jobs/:jobId/referrals",
    { preHandler: requirePermission({ jobs: ["edit"] }) },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      const parsed = createReferralSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const referral = await create(
        app.prisma,
        jobId,
        parsed.data,
        getUserId(req)
      );
      return reply.status(201).send({ data: referral });
    }
  );

  app.patch(
    "/referrals/:id",
    { preHandler: requirePermission({ jobs: ["edit"] }) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateReferralSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const referral = await update(app.prisma, id, parsed.data);
      return reply.send({ data: referral });
    }
  );
};
