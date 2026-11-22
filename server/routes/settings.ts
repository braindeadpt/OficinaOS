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
import { decryptSecret } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import { requirePermission } from "../middlewares/rbac.js";
import {
  findShopSettingsUnique,
  getOrCreateShopSettings,
} from "../repositories/settings.repository.js";
import { getBackupStatus } from "../services/backup-status.service.js";
import {
  generateDiagPairingCode,
  getCloudStatus,
  listCloudStations,
  pairWithCloud,
  revokeCloudStation,
  syncCloudEntitlements,
  unpairCloud,
} from "../services/cloud.service.js";
import {
  buildTestTicketEscPos,
  sendToPrinter,
} from "../services/escpos.service.js";
import {
  disconnectEvolutionInstance,
  type EvolutionConfig,
  getEvolutionState,
  pairEvolutionInstance,
  setEvolutionWebhook,
} from "../services/evolution.service.js";
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
  generateSmsWebhookToken,
  registerSmsWebhook,
  sendSms,
} from "../services/sms.service.js";
import { getSmsDeviceStatus } from "../services/sms-cloud.service.js";
import { getUpdateState, startUpdate } from "../services/update.service.js";
import { pushCredentialsToCloud } from "../services/whatsapp-channel.js";

// Campos de definições que mudam o corpo Meta dos templates WhatsApp
// (blocos {{if}} expandidos por configuração) — um PUT que os toca tem de
// re-sincronizar para o modelo aprovado acompanhar o novo corpo.
const META_TEMPLATE_KEYS = new Set([
  "reviewUrl",
  "shopName",
  "trackingBaseUrl",
]);

import {
  getWhatsAppTemplateStatuses,
  syncWhatsAppTemplates,
} from "../services/whatsapp-templates.service.js";
import { isModuleEnabled } from "../utils/modules.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

/**
 * Transporte local (Evolution): free, mas exige o disclaimer de
 * responsabilidade aceite — o resolve no outbox revalida-o antes de cada
 * envio. Remarketing usa templates Meta, que não existem no modo local.
 */
function assertEvolutionGates(
  data: {
    botDailyCap?: number;
    botDisclaimerAccepted?: boolean;
    disclaimerAccepted?: boolean;
    enabled?: boolean;
    remarketingEnabled?: boolean;
    transport?: string;
  },
  settings: {
    whatsappLocalDisclaimerAt?: Date | null;
    whatsappTransport?: string;
  }
): void {
  const wantsEvolution =
    (data.transport ?? settings.whatsappTransport) === "evolution";
  // O termo do bot e o teto diário só fazem sentido no transporte local.
  if (
    !wantsEvolution &&
    (data.botDisclaimerAccepted !== undefined || data.botDailyCap !== undefined)
  ) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { transport: ["validations.invalid_option"] },
    });
  }
  if (!wantsEvolution) {
    return;
  }
  if (
    data.enabled &&
    !(data.disclaimerAccepted || settings.whatsappLocalDisclaimerAt)
  ) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { disclaimerAccepted: ["validations.disclaimer_required"] },
    });
  }
  if (data.remarketingEnabled) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { remarketingEnabled: ["validations.invalid_option"] },
    });
  }
}

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
      assertNotDemoMode();
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
    "/cloud/diag-code",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Generate a pairing code for an OficinaDiag PC",
      },
    },
    async (_req, reply) => reply.send(await generateDiagPairingCode(app.prisma))
  );

  app.get(
    "/cloud/tokens",
    {
      schema: {
        tags: ["settings"],
        summary: "List OficinaOS Cloud stations (paired Diag PCs)",
      },
    },
    async (_req, reply) =>
      reply.send({ tokens: await listCloudStations(app.prisma) })
  );

  app.post(
    "/cloud/tokens/:id/revoke",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Revoke an OficinaOS Cloud station",
        params: {
          type: "object",
          properties: { id: { type: "string", minLength: 1 } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await revokeCloudStation(app.prisma, id);
      return reply.send({ revoked: true });
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

  app.get(
    "/sms-cloud-device",
    {
      schema: {
        tags: ["settings"],
        summary: "SMS Pro cloud gateway device status",
      },
    },
    async (_req, reply) => reply.send(await getSmsDeviceStatus(app.prisma))
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
    async (req, reply) => {
      assertNotDemoMode();
      const { cloudDeleted } = await unpairCloud(app.prisma, req.log);
      return reply.send({ ok: true, cloudDeleted });
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
      assertNotDemoMode();
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
      assertNotDemoMode();
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
      assertNotDemoMode();
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
      // The widget CSP caches embedAllowedOrigins for 60s — drop it so a
      // save takes effect on the next request instead of up to a minute late.
      app.resetEmbedOriginsCache();
      // reviewUrl/trackingBaseUrl/shopName mudam os blocos {{if}} dos
      // templates WhatsApp — sem re-sync, o modelo aprovado na Meta
      // diverge dos parâmetros enviados e as notificações falham.
      if (Object.keys(parsed.data).some((k) => META_TEMPLATE_KEYS.has(k))) {
        syncWhatsAppTemplates(app.prisma).catch((err) =>
          req.log.warn({ err }, "whatsapp template resync failed")
        );
      }
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
      assertNotDemoMode();
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
      const s = await getOrCreateShopSettings(app.prisma);
      if (
        parsed.data.remarketingEnabled &&
        !isModuleEnabled(s, "remarketing")
      ) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
      assertEvolutionGates(parsed.data, s);
      const updated = await upsertWhatsAppSettings(
        app.prisma,
        parsed.data,
        req.user?.id
      );
      // §5.7 — com o bot Evolution habilitado pelo termo, regista o
      // webhook inbound na instância (mesmo truque do SMS: o Host que o
      // browser do staff usou é o endereço que a Evolution alcança).
      if (
        parsed.data.botDisclaimerAccepted === true ||
        parsed.data.transport === "evolution"
      ) {
        await tryRegisterEvolutionWebhook(
          app.prisma,
          req.headers.host ?? ""
        ).catch((err) =>
          app.log.warn({ err }, "evolution webhook register failed")
        );
      }
      // Migração silenciosa: envia as credenciais Meta para o relay da
      // cloud. Se falhar (cloud em baixo / sem entitlement) fica para a
      // próxima gravação — o envio local continua a funcionar entretanto.
      const credentialsAtCloud = await pushCredentialsToCloud(app.prisma);
      // §5.6 C.2 — ao ligar/configurar o WhatsApp, corre o sync de
      // templates Meta em background (GET primeiro, cria o que falta).
      if (parsed.data.enabled) {
        syncWhatsAppTemplates(app.prisma, app.log).catch((err) =>
          app.log.warn({ err }, "whatsapp-templates sync falhou")
        );
      }
      return reply.send({ ...updated, credentialsAtCloud });
    }
  );

  // Estado do sync de templates Meta — leitura do último resultado
  // persistido (não chama a Meta/Cloud em cada GET).
  app.get(
    "/whatsapp/templates",
    {
      schema: {
        tags: ["settings"],
        summary: "Meta template sync status per template",
      },
    },
    async (_req, reply) =>
      reply.send({ templates: await getWhatsAppTemplateStatuses(app.prisma) })
  );

  // "Voltar a submeter" — corre o sync contra a Meta (local) ou a Cloud (Pro).
  app.post(
    "/whatsapp/templates/sync",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Re-run the Meta template sync",
      },
    },
    async (_req, reply) =>
      reply.send(await syncWhatsAppTemplates(app.prisma, app.log))
  );

  // Evolution API (WhatsApp local, free) — o serviço corre na LAN da
  // loja; estes endpoints fazem pairing (QR/código), health check e
  // disconnect. O envio em si passa pelo resolveWhatsAppChannel.
  async function evolutionConfigOrNull(): Promise<EvolutionConfig | null> {
    const s = await getOrCreateShopSettings(app.prisma);
    const apiKey = s.evolutionApiKeyEncrypted
      ? decryptSecret(s.evolutionApiKeyEncrypted)
      : null;
    if (!(s.evolutionUrl && apiKey)) {
      return null;
    }
    return {
      apiKey,
      baseUrl: s.evolutionUrl,
      instance: s.evolutionInstance ?? "oficinaos",
    };
  }

  app.get(
    "/whatsapp/evolution/status",
    { schema: { tags: ["settings"], summary: "Evolution session state" } },
    async (_req, reply) => {
      const config = await evolutionConfigOrNull();
      if (!config) {
        return reply.send({ state: "unconfigured" });
      }
      return reply.send({
        state: await getEvolutionState(
          config.baseUrl,
          config.apiKey,
          config.instance
        ),
      });
    }
  );

  app.post(
    "/whatsapp/evolution/pair",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Create/fetch QR + pairing code for the local session",
      },
    },
    async (req, reply) => {
      assertNotDemoMode();
      // Pairing é free — corre na LAN da loja. O disclaimer continua a
      // ser exigido ao ativar o transporte (assertEvolutionGates) e o
      // outbox revalida-o antes de cada envio.
      const config = await evolutionConfigOrNull();
      if (!config) {
        throw new AppError("VALIDATION_ERROR", {
          errors: { evolutionUrl: ["validations.invalid_url"] },
        });
      }
      const pairing = await pairEvolutionInstance(config);
      if ("error" in pairing) {
        return reply.send({ ok: false, error: pairing.error });
      }
      // Termo já aceite numa gravação anterior → a instância (re)criada
      // fica sem webhook até ao próximo save; regista já no pair.
      await tryRegisterEvolutionWebhook(
        app.prisma,
        req.headers.host ?? ""
      ).catch((err) =>
        req.log.warn({ err }, "evolution webhook register failed")
      );
      return reply.send({ ok: true, ...pairing });
    }
  );

  app.post(
    "/whatsapp/evolution/disconnect",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        tags: ["settings"],
        summary: "Logout the local WhatsApp session",
      },
    },
    async (_req, reply) => {
      assertNotDemoMode();
      const config = await evolutionConfigOrNull();
      if (!config) {
        return reply.send({ ok: true });
      }
      const { success } = await disconnectEvolutionInstance(config);
      return reply.send({ ok: success });
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
      assertNotDemoMode();
      const parsed = updateSmsSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      // O gateway Android na LAN é free — o módulo Pro "sms" gateia
      // apenas transportes geridos (provider via cloud), que terão o
      // seu próprio caminho de configuração e de entitlement.
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
      assertNotDemoMode();
      const body = (req.body ?? {}) as { phone?: string };
      const row = await getOrCreateShopSettings(app.prisma);
      // Free: o teste sai pelo gateway Android local — só exige o
      // gateway configurado, não o módulo Pro.
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
      assertNotDemoMode();
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
      assertNotDemoMode();
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
        if (!isModuleEnabled(s, "invoicing")) {
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

/**
 * §5.7 — regista o webhook MESSAGES_UPSERT na instância Evolution. Só
 * com o termo do bot aceite (a rota inbound nem existe sem ele); o
 * callback usa `evolutionWebhookToken` — segredo próprio, separado do
 * SMS — e o Host do pedido, como no tryRegisterSmsWebhook.
 */
async function tryRegisterEvolutionWebhook(
  prisma: Parameters<typeof getSmsSettings>[0],
  host: string
): Promise<boolean> {
  if (!host || LOCALHOST_RE.test(host)) {
    return false;
  }
  let row = await getOrCreateShopSettings(prisma);
  // Instalações que aceitaram o termo antes do token próprio existir:
  // gera-o aqui — o token SMS não é reutilizado (§5.7, ver rota pública).
  if (
    row.whatsappTransport === "evolution" &&
    row.whatsappBotDisclaimerAt &&
    !row.evolutionWebhookToken
  ) {
    await prisma.shopSettings.updateMany({
      data: { evolutionWebhookToken: generateSmsWebhookToken() },
      where: { id: "default", evolutionWebhookToken: null },
    });
    row = await getOrCreateShopSettings(prisma);
  }
  if (
    !(
      row.whatsappTransport === "evolution" &&
      row.whatsappBotDisclaimerAt &&
      row.evolutionWebhookToken &&
      row.evolutionUrl &&
      row.evolutionApiKeyEncrypted
    )
  ) {
    return false;
  }
  const apiKey = decryptSecret(row.evolutionApiKeyEncrypted);
  if (!apiKey) {
    return false;
  }
  const callbackUrl = `http://${host}/api/public/whatsapp/evolution/inbound/${row.evolutionWebhookToken}`;
  const result = await setEvolutionWebhook(
    {
      apiKey,
      baseUrl: row.evolutionUrl,
      instance: row.evolutionInstance ?? "oficinaos",
    },
    callbackUrl
  );
  return result.success;
}
