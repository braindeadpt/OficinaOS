import { AppError } from "@shared/errors/app-error.js";
import {
  pairCloudSchema,
  updateAiSettingsSchema,
  updateInvoicingSettingsSchema,
  updateShopSettingsSchema,
  updateSmsSettingsSchema,
  updateWhatsAppSettingsSchema,
} from "@shared/schemas/settings.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  findShopSettingsUnique,
  getOrCreateShopSettings,
} from "../repositories/settings.repository.js";
import { getBackupStatus } from "../services/backup-status.service.js";
import {
  getCloudStatus,
  pairWithCloud,
  syncCloudEntitlements,
  unpairCloud,
} from "../services/cloud.service.js";
import {
  buildTestTicketEscPos,
  sendToPrinter,
} from "../services/escpos.service.js";
import {
  getAiSettings,
  getInvoicingSettings,
  getShopSettings,
  getSmsSettings,
  getWhatsAppSettings,
  testAiConnection,
  upsertAiSettings,
  upsertInvoicingSettings,
  upsertShopSettings,
  upsertSmsSettings,
  upsertWhatsAppSettings,
} from "../services/settings.service.js";
import {
  decryptSmsConfig,
  registerSmsWebhook,
  sendSms,
} from "../services/sms.service.js";
import { getUpdateState, startUpdate } from "../services/update.service.js";
import { pushCredentialsToCloud } from "../services/whatsapp-channel.js";
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

  // Test ticket on a network ESC/POS printer — uses the submitted host/port
  // when provided (test before saving), otherwise the saved settings.
  app.post(
    "/printer-test",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Send a test ticket to a network thermal printer",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as { host?: string; port?: number };
      const settings = await findShopSettingsUnique(app.prisma);
      const host = body.host ?? settings?.printerHost;
      const port = body.port ?? settings?.printerPort ?? 9100;
      if (!host) {
        throw new AppError("PRINTER_NOT_CONFIGURED");
      }
      try {
        await sendToPrinter(host, port, buildTestTicketEscPos(settings));
      } catch {
        throw new AppError("PRINTER_UNREACHABLE");
      }
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
    async (_req, reply) => reply.send(await getUpdateState())
  );

  app.get(
    "/update/status",
    {
      schema: {
        tags: ["settings"],
        summary: "In-app update progress (state machine + version info)",
      },
    },
    async (_req, reply) => reply.send(await getUpdateState())
  );

  app.post(
    "/update",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Start a lightweight in-app update (backup + rollback)",
      },
    },
    async (_req, reply) => reply.code(202).send(await startUpdate())
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
      // Enabling remarketing requires the Pro module — enforced again by
      // the sweep on the cached entitlements.
      if (parsed.data.remarketingEnabled) {
        const s = await getOrCreateShopSettings(app.prisma);
        const modules = Array.isArray(s.cloudEntitlements)
          ? (s.cloudEntitlements as string[])
          : [];
        if (!modules.includes("remarketing")) {
          throw new AppError("CLOUD_MODULE_REQUIRED");
        }
      }
      const updated = await upsertWhatsAppSettings(app.prisma, parsed.data);
      // Migração silenciosa: envia as credenciais Meta para o relay da
      // cloud. Se falhar (cloud em baixo / sem entitlement) fica para a
      // próxima gravação — o envio local continua a funcionar entretanto.
      const credentialsAtCloud = await pushCredentialsToCloud(app.prisma);
      return reply.send({ ...updated, credentialsAtCloud });
    }
  );

  app.get(
    "/sms",
    {
      schema: {
        tags: ["settings"],
        summary: "Get SMS gateway settings — password never exposed",
      },
    },
    async (_req, reply) => {
      const settings = await getSmsSettings(app.prisma);
      return reply.send(settings);
    }
  );

  app.put(
    "/sms",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Update SMS gateway settings (sms-gate local server)",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = updateSmsSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      await upsertSmsSettings(app.prisma, parsed.data);

      // Best-effort: regista o webhook inbound no telemóvel usando o
      // Host do pedido — o endereço a que o browser chegou é também o
      // que o telemóvel consegue alcançar na LAN. Em localhost não há
      // como o telemóvel chegar — a UI avisa nesse caso.
      let webhookRegistered = false;
      const settings = await getSmsSettings(app.prisma);
      if (settings.enabled) {
        const host = req.headers.host ?? "";
        webhookRegistered = await tryRegisterSmsWebhook(app.prisma, host);
      }
      return reply.send({ ...settings, webhookRegistered });
    }
  );

  app.post(
    "/sms/test",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Send a test SMS through the configured gateway",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as { phone?: string };
      const row = await getOrCreateShopSettings(app.prisma);
      const config = decryptSmsConfig({
        gatewayPasswordEncrypted: row.smsGatewayPasswordEncrypted,
        gatewayUrl: row.smsGatewayUrl,
        gatewayUser: row.smsGatewayUser,
      });
      if (!config) {
        throw new AppError("SMS_NOT_CONFIGURED");
      }
      const phone = body.phone ?? row.phone;
      if (!phone) {
        throw new AppError("NO_SHOP_PHONE");
      }
      const result = await sendSms(
        config,
        phone,
        `Teste OficinaOS — o gateway SMS está a funcionar. (${new Date().toLocaleTimeString("pt-PT")})`,
        row.countryCode ?? "PT"
      );
      if (!result.success) {
        throw new AppError("SMS_SEND_FAILED", { detail: result.error });
      }
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/sms/webhook",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Register the inbound webhook on the sms-gate device",
      },
    },
    async (req, reply) => {
      const ok = await tryRegisterSmsWebhook(
        app.prisma,
        req.headers.host ?? ""
      );
      if (!ok) {
        throw new AppError("SMS_WEBHOOK_FAILED");
      }
      return reply.send({ ok: true });
    }
  );

  app.get(
    "/invoicing",
    {
      schema: {
        tags: ["settings"],
        summary: "Get invoicing (InvoiceXpress) settings — key never exposed",
      },
    },
    async (_req, reply) => {
      const settings = await getInvoicingSettings(app.prisma);
      return reply.send(settings);
    }
  );

  app.put(
    "/invoicing",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Update invoicing (InvoiceXpress) settings",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = updateInvoicingSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      // Enabling invoicing requires the Pro module — the issue path also
      // gates on the cached entitlements.
      if (parsed.data.enabled) {
        const s = await getOrCreateShopSettings(app.prisma);
        const modules = Array.isArray(s.cloudEntitlements)
          ? (s.cloudEntitlements as string[])
          : [];
        if (!modules.includes("invoicing")) {
          throw new AppError("CLOUD_MODULE_REQUIRED");
        }
      }
      const updated = await upsertInvoicingSettings(app.prisma, parsed.data);
      return reply.send({ ok: true, updated: Boolean(updated) });
    }
  );
};

const LOCALHOST_RE = /^(localhost|127\.|::1|\[::1\])/i;

/**
 * Regista o webhook inbound no telemóvel. O callback usa o Host do pedido
 * — o endereço por que o browser do staff chegou à app é o mesmo que o
 * telemóvel alcança na LAN. Quando a sessão corre em localhost o telemóvel
 * nunca lá chega, por isso nem se tenta.
 */
async function tryRegisterSmsWebhook(
  prisma: Parameters<typeof getSmsSettings>[0],
  host: string
): Promise<boolean> {
  if (!host || LOCALHOST_RE.test(host)) {
    return false;
  }
  const row = await getOrCreateShopSettings(prisma);
  const config = decryptSmsConfig({
    gatewayPasswordEncrypted: row.smsGatewayPasswordEncrypted,
    gatewayUrl: row.smsGatewayUrl,
    gatewayUser: row.smsGatewayUser,
  });
  if (!(config && row.smsWebhookToken)) {
    return false;
  }
  const callbackUrl = `http://${host}/api/public/sms/inbound/${row.smsWebhookToken}`;
  const result = await registerSmsWebhook(config, callbackUrl);
  return result.success;
}
