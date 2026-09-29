import { AppError } from "@shared/errors/app-error.js";
import {
  updateAiSettingsSchema,
  updateShopSettingsSchema,
  updateWhatsAppSettingsSchema,
} from "@shared/schemas/settings.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import { getBackupStatus } from "../services/backup-status.service.js";
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
