import { AppError } from "@shared/errors/app-error.js";
import {
  pairCloudSchema,
  updateAiSettingsSchema,
  updateShopSettingsSchema,
  updateWhatsAppSettingsSchema,
} from "@shared/schemas/settings.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import { getAppVersionInfo } from "../services/app-version.service.js";
import { getBackupStatus } from "../services/backup-status.service.js";
import {
  getCloudStatus,
  pairWithCloud,
  syncCloudEntitlements,
  unpairCloud,
} from "../services/cloud.service.js";
import {
  getAiSettings,
  getShopSettings,
  getWhatsAppSettings,
  testAiConnection,
  upsertAiSettings,
  upsertShopSettings,
  upsertWhatsAppSettings,
} from "../services/settings.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ settings: ["view"] }));

  app.get(
    "/",
    { schema: { tags: ["settings"], summary: "Get all settings" } },
    async (_req, reply) => {
      const [ai, shop] = await Promise.all([
        getAiSettings(app.prisma),
        getShopSettings(app.prisma),
      ]);
      return reply.send({ ai, shop });
    }
  );

  app.get(
    "/ai",
    { schema: { tags: ["settings"], summary: "Get AI settings" } },
    async (_req, reply) => {
      const ai = await getAiSettings(app.prisma);
      return reply.send(ai);
    }
  );

  app.get(
    "/backups/status",
    {
      schema: {
        tags: ["settings"],
        summary: "Database backup status from the backup sidecar",
      },
    },
    async (_req, reply) => reply.send(await getBackupStatus())
  );

  app.get(
    "/cloud",
    {
      schema: {
        tags: ["settings"],
        summary: "OficinaOS Cloud pairing status and cached entitlements",
      },
    },
    async (_req, reply) => reply.send(await getCloudStatus(app.prisma, app.log))
  );

  app.post(
    "/cloud/pair",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Redeem an OficinaOS Cloud pairing code",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = pairCloudSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      return reply.send(await pairWithCloud(app.prisma, parsed.data, app.log));
    }
  );

  app.post(
    "/cloud/sync",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Refresh OficinaOS Cloud entitlements",
      },
    },
    async (_req, reply) =>
      reply.send(await syncCloudEntitlements(app.prisma, app.log))
  );

  app.delete(
    "/cloud",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Unpair this installation from OficinaOS Cloud",
      },
    },
    async (_req, reply) => {
      await unpairCloud(app.prisma);
      return reply.send({ ok: true });
    }
  );

  app.get(
    "/update-check",
    {
      schema: {
        tags: ["settings"],
        summary: "Check GitHub Releases for a newer OficinaOS version",
      },
    },
    async (_req, reply) => reply.send(await getAppVersionInfo())
  );

  app.put(
    "/ai",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Update AI settings",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = updateAiSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await upsertAiSettings(app.prisma, parsed.data);
      return reply.send(updated);
    }
  );

  app.post(
    "/ai/test",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: { tags: ["settings"], summary: "Test AI connection" },
    },
    async (_req, reply) => {
      const result = await testAiConnection(app.prisma);
      return reply.send(result);
    }
  );

  app.get(
    "/shop",
    { schema: { tags: ["settings"], summary: "Get shop settings" } },
    async (_req, reply) => {
      const shop = await getShopSettings(app.prisma);
      return reply.send(shop);
    }
  );

  app.put(
    "/shop",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Update shop settings",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = updateShopSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await upsertShopSettings(app.prisma, parsed.data);
      return reply.send(updated);
    }
  );

  app.get(
    "/whatsapp",
    { schema: { tags: ["settings"], summary: "Get WhatsApp settings" } },
    async (_req, reply) => {
      const settings = await getWhatsAppSettings(app.prisma);
      return reply.send(settings);
    }
  );

  app.put(
    "/whatsapp",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Update WhatsApp settings",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = updateWhatsAppSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await upsertWhatsAppSettings(app.prisma, parsed.data);
      return reply.send(updated);
    }
  );
};
