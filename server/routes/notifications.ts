import { AppError } from "@shared/errors/app-error.js";
import {
  listInAppQuerySchema,
  markReadParamSchema,
} from "@shared/schemas/notification.schema";
import { updateNotificationTemplateSchema } from "@shared/schemas/settings.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  getInAppNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeInAppNotification,
} from "../services/notification-inapp.service.js";
import {
  cancelOutboxEntry,
  getOutboxLogs,
  testNotification,
} from "../services/notification-outbox.service.js";
import {
  getNotificationTemplates,
  updateNotificationTemplate,
} from "../services/settings.service.js";
import { syncWhatsAppTemplates } from "../services/whatsapp-templates.service.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/templates",
    {
      preHandler: [requirePermission({ notifications: ["read"] })],
      schema: {
        tags: ["notifications"],
        summary: "Get notification templates",
      },
    },
    async (_req, reply) => {
      const templates = await getNotificationTemplates(app.prisma);
      return reply.send(templates);
    }
  );

  app.put(
    "/templates/:id",
    {
      preHandler: [requirePermission({ notifications: ["manage"] })],
      schema: {
        tags: ["notifications"],
        summary: "Update notification template",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateNotificationTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const updated = await updateNotificationTemplate(
        app.prisma,
        id,
        parsed.data
      );
      if (!updated) {
        throw new AppError("TEMPLATE_NOT_FOUND");
      }
      // Corpo Meta editado: o "APPROVED" guardado pertence ao texto
      // antigo — sem re-sync o outbox envia o modelo anterior. O sync
      // deteta a divergência (remoteBody ≠ desejado) e resubmete.
      if (updated.channel === "WHATSAPP") {
        syncWhatsAppTemplates(app.prisma, req.log).catch((err) =>
          req.log.warn({ err }, "whatsapp-templates sync pós-edição falhou")
        );
      }
      return reply.send(updated);
    }
  );

  app.get(
    "/in-app",
    {
      preHandler: [requirePermission({ notifications: ["read"] })],
      schema: {
        tags: ["notifications"],
        summary: "List in-app notifications",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = listInAppQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await getInAppNotifications(
        app.prisma,
        getUserId(req),
        parsed.data.filter,
        parsed.data.limit
      );
      return reply.send({
        notifications: result.notifications,
        unreadCount: result.unreadCount,
      });
    }
  );

  app.put(
    "/in-app/:id/read",
    {
      preHandler: [requirePermission({ notifications: ["read"] })],
      schema: {
        tags: ["notifications"],
        summary: "Mark notification read",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = markReadParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const notification = await markNotificationRead(
        app.prisma,
        parsed.data.id,
        getUserId(req)
      );
      if (!notification) {
        throw new AppError("NOT_FOUND");
      }
      return reply.send({ id: notification.id, readAt: notification.readAt });
    }
  );

  app.put(
    "/in-app/read-all",
    {
      preHandler: [requirePermission({ notifications: ["read"] })],
      schema: {
        tags: ["notifications"],
        summary: "Mark all notifications read",
      },
    },
    async (req, reply) => {
      const result = await markAllNotificationsRead(app.prisma, getUserId(req));
      return reply.send({ count: result.count });
    }
  );

  app.delete(
    "/in-app/:id",
    {
      preHandler: [requirePermission({ notifications: ["manage"] })],
      schema: {
        tags: ["notifications"],
        summary: "Delete in-app notification",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await removeInAppNotification(
        app.prisma,
        id,
        getUserId(req)
      );
      if (!deleted) {
        throw new AppError("NOT_FOUND");
      }
      return reply.send({ id: deleted.id });
    }
  );

  app.get(
    "/outbox",
    {
      preHandler: [requirePermission({ notifications: ["read"] })],
      schema: { tags: ["notifications"], summary: "Get outbox logs" },
    },
    async (_req, reply) => {
      const logs = await getOutboxLogs(app.prisma);
      return reply.send(logs);
    }
  );

  app.delete(
    "/outbox/:id",
    {
      preHandler: [requirePermission({ notifications: ["manage"] })],
      schema: {
        tags: ["notifications"],
        summary: "Cancel queued outbox notification",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const cancelled = await cancelOutboxEntry(app.prisma, id);
      return reply.send({ id: cancelled.id, status: "cancelled" });
    }
  );

  app.post(
    "/test/:templateId",
    {
      preHandler: [requirePermission({ notifications: ["manage"] })],
      schema: {
        tags: ["notifications"],
        summary: "Send test notification",
        params: {
          type: "object",
          properties: { templateId: { type: "string" } },
          required: ["templateId"],
        },
      },
    },
    async (req, reply) => {
      const { templateId } = req.params as { templateId: string };
      await testNotification(app.prisma, templateId);
      return reply.send({ message: "Test notification queued", success: true });
    }
  );
};
