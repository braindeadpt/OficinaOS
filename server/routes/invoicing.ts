import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";

// Lightweight capability probe for POS/job UIs — staff roles have no
// `settings` permission, so they cannot read /api/settings/invoicing to
// know whether the "Emitir fatura" action should render. Reveals only
// booleans, never credentials.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const invoicingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/status",
    {
      schema: {
        tags: ["invoicing"],
        summary: "Whether invoicing is enabled and ready to issue documents",
      },
      preHandler: [requirePermission({ sales: ["view"] })],
    },
    async (_req, reply) => {
      const row = await app.prisma.shopSettings.findUnique({
        where: { id: "default" },
      });
      const modules = Array.isArray(row?.cloudEntitlements)
        ? (row.cloudEntitlements as string[])
        : [];
      return reply.send({
        enabled: Boolean(
          row?.invoicingEnabled &&
            row.invoicingAccount &&
            row.invoicingApiKeyEncrypted
        ),
        module: modules.includes("invoicing"),
      });
    }
  );
};
