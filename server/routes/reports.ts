import { AppError } from "@shared/errors/app-error.js";
import { closeCashSessionSchema } from "@shared/schemas/cash-session.schema.js";
import { reportsQuerySchema } from "@shared/schemas/reports.schema.js";
import type { FastifyPluginAsync } from "fastify";
import { dashboardScope } from "../middlewares/dashboard-scope.js";
import { requirePermission } from "../middlewares/rbac.js";
import { cashReport } from "../services/cash-report.service.js";
import {
  closeCashSession,
  getSessionWithReport,
  reopenCashSession,
} from "../services/cash-session.service.js";
import { partsConsumptionReport } from "../services/parts-consumption.service.js";
import {
  insightsReport,
  operationsReport,
  resolveRange,
  returnsReport,
  revenueReport,
} from "../services/reports.service.js";
import { getRole } from "../utils/request.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/revenue",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: { tags: ["reports"], summary: "Revenue & financial report" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const parsed = reportsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          issues: parsed.error.issues,
        });
      }
      const q = parsed.data;
      const range = resolveRange(q.range, q.from, q.to, scope.shopTz);

      const marginResult = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { reports: ["viewMargin"] },
        },
      });

      return revenueReport(
        app.prisma,
        scope,
        range,
        marginResult?.success === true
      );
    }
  );

  app.get(
    "/operations",
    {
      preHandler: [
        requirePermission({ reports: ["viewSelf"] }),
        dashboardScope,
      ],
      schema: { tags: ["reports"], summary: "Repair operations report" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const parsed = reportsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          issues: parsed.error.issues,
        });
      }
      const q = parsed.data;
      const range = resolveRange(q.range, q.from, q.to, scope.shopTz);

      const shopResult = await req.server.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { reports: ["viewShop"] },
        },
      });

      return operationsReport(
        app.prisma,
        scope,
        range,
        shopResult?.success === true
      );
    }
  );

  app.get(
    "/insights",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: { tags: ["reports"], summary: "Customer insights report" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const parsed = reportsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          issues: parsed.error.issues,
        });
      }
      const q = parsed.data;
      const range = resolveRange(q.range, q.from, q.to, scope.shopTz);

      return await insightsReport(app.prisma, scope, range);
    }
  );

  app.get(
    "/parts-consumption",
    {
      preHandler: [requirePermission({ parts: ["viewCost"] }), dashboardScope],
      schema: {
        tags: ["reports"],
        summary: "Parts consumption report (jobs + POS sales) with trends",
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const parsed = reportsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          issues: parsed.error.issues,
        });
      }
      const q = parsed.data;
      const range = resolveRange(q.range, q.from, q.to, scope.shopTz);

      return await partsConsumptionReport(app.prisma, scope, range, true);
    }
  );

  app.get(
    "/cash",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        tags: ["reports"],
        summary:
          "Daily cash-up report (today, shop-local): payments by method and by user",
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      return await cashReport(app.prisma, scope, scope.shopTz);
    }
  );

  app.get(
    "/cash/session",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        tags: ["reports"],
        summary:
          "Today's formal cash session (auto-opens) with live or frozen report",
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      return await getSessionWithReport(app.prisma, scope);
    }
  );

  app.post(
    "/cash/close",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        body: { type: "object", additionalProperties: true },
        tags: ["reports"],
        summary:
          "Close today's cash session with counted cash, divergence and signature",
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const parsed = closeCashSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          issues: parsed.error.issues,
        });
      }
      return await closeCashSession(app.prisma, scope, parsed.data);
    }
  );

  app.post(
    "/cash/reopen",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        tags: ["reports"],
        summary: "Reopen today's closed cash session (audit-trailed)",
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      return await reopenCashSession(app.prisma, scope);
    }
  );

  app.get(
    "/returns",
    {
      preHandler: [
        requirePermission({ returns: ["viewSelf"] }),
        dashboardScope,
      ],
      schema: { tags: ["reports"], summary: "Returns analytics report" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const parsed = reportsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          issues: parsed.error.issues,
        });
      }
      const q = parsed.data;
      const range = resolveRange(q.range, q.from, q.to, scope.shopTz);

      return await returnsReport(app.prisma, scope, range);
    }
  );
};
