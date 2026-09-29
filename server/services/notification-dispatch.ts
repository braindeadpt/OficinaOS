import type { NotifyChannel } from "@generated/client";
import type { RoleType } from "@shared/constants/roles.js";
import { findCustomerByPhone } from "../repositories/customer.repository.js";
import {
  createManyAndReturnInAppNotifications,
  findManyNotificationTemplatesByName,
  findManyUsers,
} from "../repositories/notification.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";
import { queueNotification } from "./notification-outbox.service.js";
import { renderTemplate } from "./notification-renderer.js";

interface NotifyEvent {
  context: {
    customerName?: string;
    jobCode?: string;
    recipientPhone?: string;
    [key: string]: string | undefined;
  };
  eventId?: string;
  eventName: string;
  jobId?: string;
  recipients: {
    role?: RoleType;
    userIds?: string[];
  };
}

interface ChannelHandlerContext {
  jobId?: string;
  templateBody: string;
  templateVars: Record<string, string>;
}

interface ChannelHandler {
  handle(
    prisma: DbClient,
    app: {
      wsBroadcast?: (
        predicate: (c: { role: string; userId: string }) => boolean,
        payload: Record<string, unknown>
      ) => void;
    },
    event: NotifyEvent,
    context: ChannelHandlerContext
  ): Promise<void>;
}

const inAppHandler: ChannelHandler = {
  async handle(prisma, app, event, context) {
    const userIds = event.recipients.userIds;
    let resolved: string[];
    if (userIds?.length) {
      resolved = userIds;
    } else if (event.recipients.role) {
      const users = await findManyUsers(
        prisma,
        { isActive: true, role: event.recipients.role },
        { id: true }
      );
      resolved = users.map((u) => u.id);
      if (resolved.length === 0) {
        return;
      }
    } else {
      logger.warn(
        `[notify] IN_APP handler: no userIds or role for event ${event.eventName} — skipping`
      );
      return;
    }

    const message = renderTemplate(context.templateBody, context.templateVars);

    const notifications = await createManyAndReturnInAppNotifications(
      prisma,
      resolved.map((userId) => ({
        jobId: event.jobId ?? null,
        message,
        type: event.eventName,
        userId,
      }))
    );

    if (app.wsBroadcast && notifications.length > 0) {
      const notifyUserIds = new Set(resolved);
      for (const notification of notifications) {
        app.wsBroadcast((c) => notifyUserIds.has(c.userId), {
          notification: {
            createdAt: notification.createdAt,
            id: notification.id,
            job: event.jobId
              ? {
                  id: event.jobId,
                  jobCode: context.templateVars.jobCode ?? "",
                }
              : null,
            message: notification.message,
            readAt: null,
            type: notification.type,
          },
          type: "NOTIFICATION",
        });
      }
    }
  },
};

const whatsAppHandler: ChannelHandler = {
  async handle(prisma, _app, event, context) {
    const phone = event.context.recipientPhone;
    if (!phone) {
      logger.warn(
        `[notify] WHATSAPP handler: no recipientPhone for event ${event.eventName} — skipping`
      );
      return;
    }
    // Consent gate at enqueue time: customers who did not opt in never
    // even enter the outbox. The outbox re-checks at send time.
    const customer = await findCustomerByPhone(prisma, phone);
    if (!customer?.whatsappConsent) {
      logger.info(
        `[notify] WHATSAPP handler: no WhatsApp consent for ${phone} on ${event.eventName} — skipping`
      );
      return;
    }
    await queueNotification(prisma, {
      channel: "WHATSAPP",
      jobId: event.jobId,
      recipientPhone: phone,
      templateBody: context.templateBody,
      templateName: event.eventName,
      templateVars: context.templateVars,
    });
  },
};

const HANDLERS: Record<NotifyChannel, ChannelHandler> = {
  IN_APP: inAppHandler,
  WHATSAPP: whatsAppHandler,
};

const DEFAULT_IN_APP_BODY =
  "{{eventName}}{{if jobCode}} — Job {{jobCode}}{{endif}}";

function buildTemplateVars(
  context: NotifyEvent["context"]
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v !== undefined) {
      vars[k] = v;
    }
  }
  return vars;
}

function resolveInAppBody(
  templates: { body: string; channel: NotifyChannel }[]
): string {
  const inAppTemplate = templates.find((t) => t.channel === "IN_APP");
  return inAppTemplate?.body ?? DEFAULT_IN_APP_BODY;
}

export async function notify(
  app: {
    prisma: DbClient;
    wsBroadcast?: (
      predicate: (c: { role: string; userId: string }) => boolean,
      payload: Record<string, unknown>
    ) => void;
  },
  event: NotifyEvent
): Promise<void> {
  const templates = await findManyNotificationTemplatesByName(
    app.prisma,
    event.eventName
  );

  const templateVars = buildTemplateVars(event.context);
  const inAppBody = resolveInAppBody(templates);

  await HANDLERS.IN_APP.handle(app.prisma, app, event, {
    jobId: event.jobId,
    templateBody: inAppBody,
    templateVars,
  });

  for (const template of templates) {
    if (template.channel === "IN_APP") {
      continue;
    }
    const handler = HANDLERS[template.channel];
    if (!handler) {
      logger.warn(
        `[notify] No handler for channel ${template.channel} — skipping`
      );
      continue;
    }
    await handler.handle(app.prisma, app, event, {
      jobId: event.jobId,
      templateBody: template.body,
      templateVars,
    });
  }
}

export type { NotifyEvent };
