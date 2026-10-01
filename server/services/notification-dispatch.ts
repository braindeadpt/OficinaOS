import type { NotifyChannel } from "@generated/client";
import type { RoleType } from "@shared/constants/roles.js";
import { findCustomerByPhone } from "../repositories/customer.repository.js";
import {
  createManyAndReturnInAppNotifications,
  findManyNotificationTemplatesByName,
  findManyUsers,
} from "../repositories/notification.repository.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
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
  whatsappEnabled: boolean;
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
    // Disabled channel never creates outbox entries — a dead QUEUED row
    // would sit forever or flush late when the channel is re-enabled.
    if (!context.whatsappEnabled) {
      return;
    }
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

/**
 * Production dispatch supplies shop-level values from ShopSettings so
 * templates render for every channel without relying on testNotification:
 * shopName for signatures ({{if shopName}} — {{shopName}}{{endif}}),
 * trackingBaseUrl for customer links, whatsappEnabled to gate the channel.
 * Event contexts may still override shopName explicitly.
 */
async function resolveShopNotificationConfig(prisma: DbClient): Promise<{
  currency: string;
  reviewUrl: string | null;
  shopName: string;
  trackingBaseUrl: string | null;
  whatsappEnabled: boolean;
}> {
  try {
    const shop = await findShopSettingsUnique(prisma);
    return {
      currency: shop?.currency ?? "EUR",
      reviewUrl: shop?.reviewUrl ?? null,
      shopName: shop?.shopName ?? "",
      trackingBaseUrl: shop?.trackingBaseUrl ?? null,
      whatsappEnabled: shop?.whatsappEnabled ?? false,
    };
  } catch (err) {
    // Notifications are best-effort: never block dispatch on a
    // settings lookup failure (e.g. row not seeded yet).
    logger.warn({ err }, "failed to resolve shop settings for notification");
    return {
      currency: "EUR",
      reviewUrl: null,
      shopName: "",
      trackingBaseUrl: null,
      whatsappEnabled: false,
    };
  }
}

const NON_DIGIT_RE = /\D/g;
const TRAILING_SLASH_RE = /\/+$/;

/**
 * Deep link into the public tracking page: /tracking/<code>?phone4=<last4>
 * opens the job view straight from the WhatsApp message. Only built when
 * the shop configured a public base URL — LAN-only installs simply omit it.
 */
function buildTrackingUrl(
  trackingBaseUrl: string,
  jobCode: string,
  recipientPhone: string
): string | null {
  const phone4 = recipientPhone.replace(NON_DIGIT_RE, "").slice(-4);
  if (phone4.length !== 4) {
    return null;
  }
  const base = trackingBaseUrl.replace(TRAILING_SLASH_RE, "");
  return `${base}/tracking/${encodeURIComponent(jobCode)}?phone4=${phone4}`;
}

function buildTemplateVars(
  context: NotifyEvent["context"],
  shopName: string
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v !== undefined) {
      vars[k] = v;
    }
  }
  // Context-provided shopName (if any) wins over the settings value.
  if (shopName && vars.shopName === undefined) {
    vars.shopName = shopName;
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

  const shop = await resolveShopNotificationConfig(app.prisma);
  const templateVars = buildTemplateVars(event.context, shop.shopName);
  if (templateVars.currency === undefined) {
    templateVars.currency = shop.currency;
  }
  if (
    shop.trackingBaseUrl &&
    templateVars.jobCode &&
    event.context.recipientPhone
  ) {
    const trackingUrl = buildTrackingUrl(
      shop.trackingBaseUrl,
      templateVars.jobCode,
      event.context.recipientPhone
    );
    if (trackingUrl) {
      templateVars.trackingUrl = trackingUrl;
    }
  }
  if (shop.reviewUrl && templateVars.reviewUrl === undefined) {
    templateVars.reviewUrl = shop.reviewUrl;
  }
  const inAppBody = resolveInAppBody(templates);

  await HANDLERS.IN_APP.handle(app.prisma, app, event, {
    jobId: event.jobId,
    templateBody: inAppBody,
    templateVars,
    whatsappEnabled: shop.whatsappEnabled,
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
      whatsappEnabled: shop.whatsappEnabled,
    });
  }
}

export type { NotifyEvent };
