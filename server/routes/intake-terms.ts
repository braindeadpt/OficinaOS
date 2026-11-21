import type { FastifyPluginCallback } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import { getShopSettings } from "../services/settings.service.js";

/**
 * Intake clauses for the repair ficha — deliberately separate from
 * GET /settings/shop: front-desk staff and technicians create intakes but
 * lack settings:view, and the signed document must carry the shop's
 * configured terms, not silently fall back to the app default.
 * Returns ONLY intakeTerms — never the rest of the shop settings.
 */
export const intakeTermsRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.addHook("preHandler", requirePermission({ jobs: ["create"] }));

  app.get(
    "/intake-terms",
    { schema: { tags: ["settings"], summary: "Get intake terms" } },
    async (_req, reply) => {
      const settings = await getShopSettings(app.prisma);
      return reply.send({ intakeTerms: settings?.intakeTerms ?? null });
    }
  );

  done();
};
