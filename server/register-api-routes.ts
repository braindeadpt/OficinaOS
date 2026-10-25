import type { FastifyInstance } from "fastify";
import { aiRoutes } from "./routes/ai.js";
import { authRoutes } from "./routes/auth.js";
import { businessRoutes } from "./routes/business.js";
import { customersRoutes } from "./routes/customers.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { dataIoRoutes } from "./routes/data-io.js";
import { demoRoutes } from "./routes/demo.js";
import { devicesRoutes } from "./routes/devices.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { healthRoutes } from "./routes/health.js";
import { intakeRequestsRoutes } from "./routes/intake-requests.js";
import { invoicingRoutes } from "./routes/invoicing.js";
import { jobRoutes } from "./routes/jobs.js";
import { marketPricesRoutes } from "./routes/market-prices.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { partRequestsRoutes } from "./routes/part-requests.js";
import { partsRoutes } from "./routes/parts.js";
import { paymentRoutes } from "./routes/payments.js";
import { publicRoutes } from "./routes/public.js";
import { purchaseOrdersRoutes } from "./routes/purchase-orders.js";
import { receiptRoutes } from "./routes/receipts.js";
import { referralsRoutes } from "./routes/referrals.js";
import { repairCatalogRoutes } from "./routes/repairs.js";
import { reportsRoutes } from "./routes/reports.js";
import { returnClaimsRoutes } from "./routes/return-claims.js";
import { saleRoutes } from "./routes/sales.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";
import { signatureSessionRoutes } from "./routes/signature-sessions.js";
import { storefrontRoutes } from "./routes/storefront.js";
import { supplierRmasRoutes, suppliersRoutes } from "./routes/suppliers.js";
import { tasksRoutes } from "./routes/tasks.js";
import { tradeInsRoutes } from "./routes/trade-ins.js";
import { usersRoutes } from "./routes/users.js";
import { workflowRoutes } from "./routes/workflow.js";

/**
 * Every /api route the server mounts — shared between server/index.ts
 * and the demo route-classification test so the inventory the test sees
 * can never drift from what production actually serves. (The better-auth
 * /api/auth/* catch-all is NOT here: it is registered by authPlugin,
 * which also installs session hooks. Tests stub it with a bare
 * app.all("/api/auth/*").)
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authRoutes);
  await app.register(demoRoutes);
  await app.register(setupRoutes);

  app.register(healthRoutes);
  app.register(publicRoutes, { prefix: "/api/public" });
  app.register(intakeRequestsRoutes, { prefix: "/api/intake-requests" });
  app.register(jobRoutes, { prefix: "/api/jobs" });
  app.register(paymentRoutes, { prefix: "/api/payments" });
  app.register(receiptRoutes, { prefix: "/api/receipts" });
  app.register(partsRoutes, { prefix: "/api/parts" });
  app.register(repairCatalogRoutes, { prefix: "/api/repairs" });
  app.register(customersRoutes, { prefix: "/api/customers" });
  app.register(devicesRoutes, { prefix: "/api/brands" });
  app.register(usersRoutes, { prefix: "/api/users" });
  app.register(notificationsRoutes, { prefix: "/api/notifications" });
  app.register(settingsRoutes, { prefix: "/api/settings" });
  app.register(signatureSessionRoutes, { prefix: "/api/sign-sessions" });
  app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  app.register(aiRoutes, { prefix: "/api/ai" });
  app.register(reportsRoutes, { prefix: "/api/reports" });
  app.register(saleRoutes, { prefix: "/api/sales" });
  app.register(returnClaimsRoutes, { prefix: "/api/return-claims" });
  app.register(tradeInsRoutes, { prefix: "/api/trade-ins" });
  app.register(partRequestsRoutes, { prefix: "/api/part-requests" });
  app.register(marketPricesRoutes, { prefix: "/api/market-prices" });
  app.register(storefrontRoutes, { prefix: "/api/storefront" });
  app.register(invoicingRoutes, { prefix: "/api/invoicing" });
  app.register(feedbackRoutes, { prefix: "/api/feedback" });
  app.register(suppliersRoutes, { prefix: "/api/suppliers" });
  app.register(supplierRmasRoutes, { prefix: "/api/supplier-rmas" });
  app.register(workflowRoutes, { prefix: "/api/workflow" });
  app.register(businessRoutes, { prefix: "/api/business" });
  app.register(purchaseOrdersRoutes, { prefix: "/api/purchase-orders" });
  app.register(tasksRoutes, { prefix: "/api/tasks" });
  app.register(referralsRoutes, { prefix: "/api" });
  app.register(dataIoRoutes, { prefix: "/api" });
}
