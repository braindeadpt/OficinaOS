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
import { startMdnsResponder } from "./lib/mdns.js";
import { isFileRequestPath } from "./lib/spa-fallback.js";
import { cacheControlFor } from "./lib/static-cache.js";
import authPlugin from "./plugins/auth.js";
import demoPlugin from "./plugins/demo.js";
import { localePlugin } from "./plugins/locale.js";
import prismaPlugin from "./plugins/prisma.js";
import securityPlugin from "./plugins/security.js";
import { websocketPlugin, wsBroadcast } from "./plugins/websocket.js";
import { registerApiRoutes } from "./register-api-routes.js";
import { startLowStockScheduler } from "./services/low-stock.service.js";
import { cleanupReadNotifications } from "./services/notification-inapp.service.js";
import { startOutboxWorker } from "./services/notification-outbox.service.js";
import { startRemarketingScheduler } from "./services/remarketing.service.js";
import { applyTaskRules } from "./services/tasks.service.js";
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
await app.register(demoPlugin);

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

// Demo uploads are capped at 1 MB per file (images only — enforced by the
// per-route MIME allowlists) so the shared instance cannot fill the disk.
await app.register(multipart, {
  limits: {
    fileSize: env.DEMO_MODE ? 1024 * 1024 : 5 * 1024 * 1024,
  },
});
await app.register(websocket);
await app.register(localePlugin);

await app.register(prismaPlugin);

// DEMO_MODE first boot: an empty database would leave the demo dead —
// /setup is disabled and nobody could sign in. Seed the fictional
// dataset once (seedDemo refuses non-"demo" database names itself).
if (env.DEMO_MODE) {
  const userCount = await app.prisma.user.count();
  if (userCount === 0) {
    app.log.info("DEMO_MODE: empty database — seeding fictional dataset");
    const { seedDemo } = await import("../prisma/seed-demo.js");
    await seedDemo(app.prisma as never);
    app.log.info("DEMO_MODE: demo dataset seeded");
  }
}

await app.register(authPlugin);
await app.register(websocketPlugin);
(app.decorate as (name: string, value: unknown) => void)(
  "wsBroadcast",
  wsBroadcast
);

setAppInstance(app);
// Local-only jobs still run in DEMO_MODE (they only write to the DB and
// make the demo feel alive); everything that can send data out — the
// Cloud poller, WhatsApp remarketing and the notification outbox worker —
// is never started.
const noop = () => undefined;
const stopOverdue = startOverdueScheduler(app);
const stopCloudPoller = env.DEMO_MODE ? noop : startCloudPoller(app);
const stopLowStock = startLowStockScheduler(app);
const stopRemarketing = env.DEMO_MODE ? noop : startRemarketingScheduler(app);
const stopOutboxWorker = env.DEMO_MODE ? noop : startOutboxWorker(app.prisma);
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

await registerApiRoutes(app);

let tasksRunning = false;
const reconcileTasks = async () => {
  if (tasksRunning) {
    return;
  }
  tasksRunning = true;
  try {
    await applyTaskRules(app.prisma);
  } catch (err) {
    app.log.error({ err }, "Task automation failed; will retry");
  } finally {
    tasksRunning = false;
  }
};
// Rules reconcile incrementally (per-rule scanCursor), so the sweep only
// advances new transitions — a 5-minute cadence is enough.
const taskTimer = setInterval(reconcileTasks, 300_000);
taskTimer.unref();
app.addHook("onReady", reconcileTasks);
app.addHook("onClose", () => {
  clearInterval(taskTimer);
  return Promise.resolve();
});
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
    mdns?.close();
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

// mDNS: advertises <MDNS_HOSTNAME>.local so LAN devices survive IP changes.
// Non-fatal — another responder may already own port 5353.
const mdns = env.MDNS_HOSTNAME
  ? startMdnsResponder(env.MDNS_HOSTNAME, app.log)
  : null;
