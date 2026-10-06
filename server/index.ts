import fs from "node:fs/promises";
import path from "node:path";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { LogController } from "fastify";
import { loadEnv } from "./config/env.js";
import { setAppInstance } from "./jobs/app-registry.js";
import { startCloudPoller } from "./jobs/cloud-poller.js";
import { startOverdueScheduler } from "./jobs/overdue-scheduler.js";
import { isFileRequestPath } from "./lib/spa-fallback.js";
import { cacheControlFor } from "./lib/static-cache.js";
import authPlugin from "./plugins/auth.js";
import { localePlugin } from "./plugins/locale.js";
import prismaPlugin from "./plugins/prisma.js";
import securityPlugin from "./plugins/security.js";
import { websocketPlugin, wsBroadcast } from "./plugins/websocket.js";
import { aiRoutes } from "./routes/ai.js";
import { authRoutes } from "./routes/auth.js";
import { customersRoutes } from "./routes/customers.js";
import { dashboardRoutes } from "./routes/dashboard.js";
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
import { receiptRoutes } from "./routes/receipts.js";
import { repairCatalogRoutes } from "./routes/repairs.js";
import { reportsRoutes } from "./routes/reports.js";
import { returnClaimsRoutes } from "./routes/return-claims.js";
import { saleRoutes } from "./routes/sales.js";
import { settingsRoutes } from "./routes/settings.js";
import { storefrontRoutes } from "./routes/storefront.js";
import { tradeInsRoutes } from "./routes/trade-ins.js";
import { usersRoutes } from "./routes/users.js";
import { startLowStockScheduler } from "./services/low-stock.service.js";
import { cleanupReadNotifications } from "./services/notification-inapp.service.js";
import { startOutboxWorker } from "./services/notification-outbox.service.js";
import { startRemarketingScheduler } from "./services/remarketing.service.js";
import { initValidationI18n } from "./utils/resolve-validation-messages.js";

const env = loadEnv();
const IS_PROD = env.NODE_ENV === "production";

const app = Fastify({
  logger: { level: env.LOG_LEVEL },
  // Opt-in only: on a direct LAN deployment every client can spoof
  // X-Forwarded-For, bypassing all IP-keyed rate limits. Deployments
  // behind a real proxy (Cloudflare Tunnel, Coolify) must set
  // TRUST_PROXY=true explicitly.
  trustProxy: env.TRUST_PROXY ?? false,
  requestIdHeader: false,
  // Top-level `requestIdLogLabel` is deprecated (FSTDEP024) — it now lives
  // on the log controller.
  logController: new LogController({ requestIdLogLabel: "reqId" }),
  connectionTimeout: 60_000,
  requestTimeout: 30_000,
  genReqId: () =>
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36),
});

app.addHook("onSend", (request, reply, _payload, done) => {
  reply.header("x-request-id", request.id);
  done();
});

await app.register(securityPlugin);

if (!IS_PROD) {
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "OficinaOS API",
        description: "Repair shop management system API",
        version: "1.0.0",
      },
      tags: [
        { name: "auth", description: "Authentication" },
        { name: "brands", description: "Brands and models" },
        { name: "jobs", description: "Job management" },
        { name: "customers", description: "Customer management" },
        { name: "users", description: "User management" },
        { name: "parts", description: "Parts catalog" },
        { name: "repairs", description: "Repair catalog" },
        { name: "notifications", description: "Notifications" },
        { name: "settings", description: "Settings" },
        { name: "dashboard", description: "Dashboard" },
        { name: "ai", description: "AI analyst" },
        { name: "reports", description: "Reports" },
        { name: "receipts", description: "Receipts and labels" },
        { name: "returns", description: "Return claims" },
        { name: "feedback", description: "In-app problem reports" },
        { name: "health", description: "Health check" },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "better-auth.session_token",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
    staticCSP: true,
  });
}

await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
await app.register(websocket);
await app.register(localePlugin);

await app.register(prismaPlugin);
await app.register(authRoutes);
await app.register(authPlugin);
await app.register(websocketPlugin);
(app.decorate as (name: string, value: unknown) => void)(
  "wsBroadcast",
  wsBroadcast
);

setAppInstance(app);
const stopOverdue = startOverdueScheduler(app);
const stopCloudPoller = startCloudPoller(app);
const stopLowStock = startLowStockScheduler(app);
const stopRemarketing = startRemarketingScheduler(app);
const stopOutboxWorker = startOutboxWorker(app.prisma);
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const cleanupHandle = setInterval(() => {
  cleanupReadNotifications(app.prisma).catch((err) => {
    app.log.error(err, "Notification cleanup error");
  });
}, CLEANUP_INTERVAL_MS);
if (cleanupHandle.unref) {
  cleanupHandle.unref();
}
cleanupReadNotifications(app.prisma).catch((err) => {
  app.log.warn(err, "Initial notification cleanup skipped");
});

app.addHook("onReady", async () => {
  await initValidationI18n();
});

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

if (IS_PROD) {
  const distRoot = path.resolve("dist");
  const indexHtml = await fs.readFile(
    path.join(distRoot, "index.html"),
    "utf8"
  );

  await app.register(staticPlugin, {
    root: distRoot,
    wildcard: false,
    // Hashed chunks are immutable; the shell, service worker and manifest
    // are revalidated so an update reaches clients on the next load.
    setHeaders: (reply, filePath) => {
      reply.header(
        "Cache-Control",
        cacheControlFor(path.relative(distRoot, filePath))
      );
    },
  });

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (pathname.startsWith("/api/") || isFileRequestPath(pathname)) {
      reply.status(404).send({
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found`,
      });
      return;
    }
    const html = indexHtml.replace(
      /<script /g,
      `<script nonce="${request.cspNonce}" `
    );
    reply.header("Cache-Control", "no-cache").type("text/html").send(html);
  });
} else {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.url} not found`,
    });
  });
}

// Uploads: served only through an authenticated pre-handler. The global
// authPlugin preHandler already rejects unauthenticated requests for anything
// not in its allow-list, so /api/uploads/** is session-gated.
await app.register(staticPlugin, {
  root: path.resolve(env.UPLOAD_DIR),
  prefix: "/api/uploads/",
  decorateReply: false,
});

process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  app.log.fatal({ err }, "Unhandled rejection");
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down...`);
    stopOverdue();
    stopCloudPoller();
    stopLowStock();
    stopRemarketing();
    stopOutboxWorker();
    clearInterval(cleanupHandle);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    { env: env.NODE_ENV, trustProxy: Boolean(env.TRUST_PROXY) },
    `OficinaOS server running on ${env.HOST}:${env.PORT}`
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
