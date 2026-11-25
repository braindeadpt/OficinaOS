import { AppError } from "@shared/errors/app-error.js";
import {
  pairCloudSchema,
  updateAiSettingsSchema,
  updateInvoicingSettingsSchema,
  updateShopSettingsSchema,
  updateSmsSettingsSchema,
  updateWhatsAppSettingsSchema,
} from "@shared/schemas/settings.schema";
import {
  ipv4Octets,
  isPublicIpv4Octets,
  isPublicIpv6,
} from "@shared/utils/ip-address.js";
import type { FastifyPluginAsync } from "fastify";
import { loadEnv } from "../config/env.js";
import { decryptSecret } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import {
  hasIsolatedNetNs,
  isDialableUrl,
  primaryLanIpv4,
} from "../lib/mdns.js";
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
  EVOLUTION_WEBHOOK_TOKEN_HEADER,
  type EvolutionConfig,
  getEvolutionState,
  pairEvolutionInstance,
  setEvolutionWebhook,
} from "../services/evolution.service.js";
import { pushPontoCloudConfig } from "../services/ponto/config-sync.js";
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
  sendSms,
} from "../services/sms.service.js";
import { getSmsDeviceStatus } from "../services/sms-cloud.service.js";
import { getUpdateState, startUpdate } from "../services/update.service.js";
import {
  pushCredentialsToCloud,
  resolveWhatsAppChannel,
} from "../services/whatsapp-channel.js";

// Campos de definições que mudam o corpo Meta dos templates WhatsApp
// (blocos {{if}} expandidos por configuração) — um PUT que os toca tem de
// re-sincronizar para o modelo aprovado acompanhar o novo corpo.
// shopName não entra: é parâmetro posicional {{N}} — o valor vai no envio,
// não no corpo aprovado. trackingBaseUrl grava-se em PUT /whatsapp.
const META_TEMPLATE_KEYS = new Set(["reviewUrl"]);

import {
  getWhatsAppTemplateStatuses,
  syncWhatsAppTemplates,
} from "../services/whatsapp-templates.service.js";
import { isModuleEnabled } from "../utils/modules.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

/**
 * Transporte local (Evolution): exige o módulo "whatsapp-bot" (gateado
 * acima) + o disclaimer de responsabilidade aceite — o resolve no
 * outbox revalida ambos antes de cada envio. Remarketing usa templates
 * Meta, que não existem no modo local.
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
      const status = await pairWithCloud(app.prisma, parsed.data, app.log);
      // Ponto: empurra a configuração completa logo no pairing — sem isto
      // a Cloud só conhecia a escala de staff quando o dono voltasse a
      // gravar as definições do ponto. Best-effort: o pairing já foi
      // concluído e o arranque seguinte torna a tentar.
      await pushPontoCloudConfig(app.prisma, app.log).catch((err) =>
        app.log.warn({ err }, "ponto config sync no pairing falhou")
      );
      return reply.send(status);
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
      // Configurar a IA fica livre — a loja pode preparar endpoint/chave
      // antes de subscrever. O que é Pro é o USO: POST /api/ai/chat/stream
      // exige o módulo "ai-inbox" fresco (decisão WP0.5).
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
      // O formulário de ponto envia sempre a hora já gravada — o sync
      // de templates só se justifica quando `pontoExitReminderTime`
      // MUDA (definir pela 1.ª vez ou editar): gravar o intervalo de
      // pausa com a mesma hora não deve re-submeter os modelos todos.
      const reminderTimeChanged =
        parsed.data.pontoExitReminderTime !== undefined &&
        (await getOrCreateShopSettings(app.prisma)).pontoExitReminderTime !==
          parsed.data.pontoExitReminderTime;
      const updated = await upsertShopSettings(app.prisma, parsed.data);
      // The widget CSP caches embedAllowedOrigins for 60s — drop it so a
      // save takes effect on the next request instead of up to a minute late.
      app.resetEmbedOriginsCache();
      // reviewUrl muda os blocos {{if}} dos templates WhatsApp — sem
      // re-sync, o modelo aprovado na Meta diverge dos parâmetros
      // enviados e as notificações falham. pontoExitReminderTime a
      // definir também exige o modelo `ponto_lembrete` submetido — o
      // sync cria-o se faltar. Só em modo Pro/cloud: sem o módulo
      // "whatsapp-bot" o resolve devolve null e nada corre (no modo
      // local a loja cria o modelo à mão — visível como MISSING na
      // lista de templates).
      const needsTemplateSync = Object.entries(parsed.data).some(
        ([key, value]) =>
          META_TEMPLATE_KEYS.has(key) ||
          (key === "pontoExitReminderTime" &&
            Boolean(value) &&
            reminderTimeChanged)
      );
      if (
        needsTemplateSync &&
        resolveWhatsAppChannel(updated)?.mode === "cloud"
      ) {
        syncWhatsAppTemplates(app.prisma, app.log).catch((err) =>
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
      // Toda a mensagem WhatsApp é Pro (decisão 2026-11-23): ativar o
      // transporte — Meta local, Evolution ou relay cloud — e aceitar o
      // termo do bot exigem o módulo "whatsapp-bot" fresco.
      const s = await getOrCreateShopSettings(app.prisma);
      if (
        (parsed.data.enabled || parsed.data.botDisclaimerAccepted) &&
        !isModuleEnabled(s, "whatsapp-bot")
      ) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
      // Enabling remarketing requires the Pro module — enforced again by
      // the sweep on the cached entitlements.
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
      // trackingBaseUrl controla um bloco {{if}} do corpo aprovado —
      // mudá-lo aqui (o formulário grava nesta rota) exige re-sync mesmo
      // sem tocar no `enabled`. Só em modo Pro/cloud — sem o módulo
      // "whatsapp-bot" o resolve devolve null e nada corre.
      if (parsed.data.enabled || parsed.data.trackingBaseUrl !== undefined) {
        const fresh = await getOrCreateShopSettings(app.prisma);
        if (resolveWhatsAppChannel(fresh)?.mode === "cloud") {
          syncWhatsAppTemplates(app.prisma, app.log).catch((err) =>
            app.log.warn({ err }, "whatsapp-templates sync falhou")
          );
        }
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

  // Evolution API (WhatsApp local, Pro) — o serviço corre na LAN da
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
      // Pairing corre na LAN da loja mas é Pro (decisão 2026-11-23):
      // exige "whatsapp-bot" fresco. O disclaimer continua a ser exigido
      // ao ativar o transporte (assertEvolutionGates) e o outbox
      // revalida o módulo antes de cada envio.
      const s = await getOrCreateShopSettings(app.prisma);
      if (!isModuleEnabled(s, "whatsapp-bot")) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
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
      // Todo o SMS é Pro (decisão 2026-11-23) — inclusive o gateway
      // Android na LAN, que fica como fallback do caminho Cloud.
      // Grátis = não envia nada: sem o módulo "sms" fresco esta rota
      // devolve 402 e nem a configuração muda.
      const s = await getOrCreateShopSettings(app.prisma);
      if (!isModuleEnabled(s, "sms")) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
      await upsertSmsSettings(app.prisma, parsed.data);
      const settings = await getSmsSettings(app.prisma);
      return reply.send(settings);
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
      // O teste envia uma mensagem real — todo o SMS é Pro (decisão
      // 2026-11-23), por isso exige o módulo "sms" fresco.
      if (!isModuleEnabled(row, "sms")) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
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

// Loopback EXATO — nunca por prefixo: «localhost.evil.com» ou
// «127.evil.com» são nomes DNS públicos legítimos e um teste de
// prefixo tratava-os como internos, entregando o token do webhook
// em HTTP claro no caminho de rede. O 127/8 não precisa de alternativa
// aqui — o ramo de octetos IPv4 já o classifica como não-público.
const LOOPBACK_HOSTS = new Set(["localhost", "::1", "[::1]"]);
const PORT_SUFFIX_RE = /:(\d+)$/;
const TRAILING_DOT_RE = /\.$/;
// Endereços internos do Docker Desktop — HTTP na mesma é seguro (a
// interface só existe dentro do host).
const DOCKER_INTERNAL_HOSTS = new Set([
  "gateway.docker.internal",
  "host.docker.internal",
]);

/** host[:port] de pedido é loopback exato (com porta opcional) —
 *  localhost, 127/8 ou ::1. */
function isLoopbackHostPort(hostPort: string): boolean {
  try {
    const h = new URL(`http://${hostPort}`).hostname
      .toLowerCase()
      .replace(TRAILING_DOT_RE, "");
    if (LOOPBACK_HOSTS.has(h)) {
      return true;
    }
    const octets = ipv4Octets(h);
    return octets !== null && octets[0] === 127;
  } catch {
    return false;
  }
}

/**
 * True quando o host do callback é LAN/interno — HTTP é aceitável
 * (a exceção trusted-LAN de security.ts). Qualquer host público
 * (domínio ou IP roteável) exige HTTPS: o token do webhook viaja num
 * header e em HTTP remoto seria sniffável em trânsito.
 */
function isPrivateCallbackHost(host: string): boolean {
  // Ponto final DNS ("192.168.1.10.") é a mesma máquina — tira-o antes
  // das comparações para não cair no ramo "hostname com ponto" → https.
  const h = host.toLowerCase().replace(TRAILING_DOT_RE, "");
  if (
    LOOPBACK_HOSTS.has(h) ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h === "0.0.0.0" ||
    h === "::" ||
    h === "[::]" ||
    DOCKER_INTERNAL_HOSTS.has(h)
  ) {
    return true;
  }
  const octets = ipv4Octets(h);
  if (octets) {
    return !isPublicIpv4Octets(octets);
  }
  if (h.startsWith("[")) {
    return !isPublicIpv6(h);
  }
  // Hostname sem ponto ("app", "oficinaos", NetBIOS/mDNS) — nome interno.
  return !h.includes(".");
}

/** scheme://host[:port] a partir de um host[:port] de pedido. O host
 *  decide o scheme: privado/LAN fica em http (a exceção trusted-LAN de
 *  security.ts), público sobe a https — o token do webhook viaja num
 *  header e em HTTP remoto seria sniffável em trânsito. `url.host`
 *  normaliza (sem userinfo, porta default do http fora) — a porta
 *  explícita não-80 mantém-se. */
function callbackBaseForHost(hostPort: string): string | null {
  let url: URL;
  try {
    url = new URL(`http://${hostPort}`);
  } catch {
    return null;
  }
  if (!url.hostname) {
    return null;
  }
  const scheme = isPrivateCallbackHost(url.hostname) ? "http" : "https";
  return `${scheme}://${url.host}`;
}

/**
 * Base (scheme://host[:port]) que a Evolution consegue alcançar para o
 * callback do webhook. O Host do pedido é a primeira escolha — o staff
 * chegou à app por ele. Em localhost num contentor com netns isolado
 * (Docker padrão) esse nome não serve e a máquina nem expõe IPv4 LAN:
 * caem-se para a APP_URL configurada (obrigatória em produção, valida-
 * da não-localhost) e, em último recurso, para o nome do serviço na
 * rede docker (`app:PORT` — o perfil wa-local põe app e Evolution na
 * mesma network do compose).
 */
function resolveEvolutionCallbackBase(requestHost: string): string | null {
  const host = requestHost.trim();
  if (!host) {
    return null;
  }
  if (!isLoopbackHostPort(host)) {
    return callbackBaseForHost(host);
  }
  const ip = primaryLanIpv4();
  if (ip) {
    const port = PORT_SUFFIX_RE.exec(host)?.[1];
    return callbackBaseForHost(`${ip}${port ? `:${port}` : ""}`);
  }
  // APP_URL configurada — em produção é obrigatória e validada
  // não-localhost; isDialableUrl rejeita loopback/wildcard (a Evolution
  // também não os alcança — seria o mesmo beco sem saída do pedido).
  const appUrl = loadEnv().APP_URL;
  if (appUrl && isDialableUrl(appUrl)) {
    try {
      const url = new URL(appUrl);
      // APP_URL explícita em HTTPS nunca desce para HTTP — o token do
      // webhook viaja num header e a loja declarou que exige TLS.
      if (url.protocol === "https:") {
        return `https://${url.host}`;
      }
      if (url.protocol === "http:") {
        return callbackBaseForHost(url.host);
      }
    } catch {
      // APP_URL malformada — segue para o fallback docker.
    }
  }
  if (hasIsolatedNetNs()) {
    return callbackBaseForHost(`app:${loadEnv().PORT}`);
  }
  return null;
}

/**
 * §5.7 — regista o webhook MESSAGES_UPSERT na instância Evolution.
 * Regista quando há consumidor: ai-inbox, bot de clientes (termo
 * aceite + entitlement "whatsapp-bot" — a rota inbound nem existe sem
 * ele, um termo aceite em tempos não pode continuar a registar após o
 * módulo expirar) ou livro de ponto (módulo "ponto" + o mesmo
 * entitlement de transporte, sem exigir o termo do bot). O callback
 * usa `evolutionWebhookToken` num header próprio — o path não leva
 * segredo (ver public.ts) — e o host resolvido por
 * resolveEvolutionCallbackBase.
 */
export async function tryRegisterEvolutionWebhook(
  prisma: Parameters<typeof getSmsSettings>[0],
  requestHost: string
): Promise<boolean> {
  const base = resolveEvolutionCallbackBase(requestHost);
  if (!base) {
    return false;
  }
  let row = await getOrCreateShopSettings(prisma);
  // Consumidores do webhook Evolution: ai-inbox (caixa de entrada sem
  // bot), o bot de clientes (precisa do termo aceite) e o livro de
  // ponto — este corre com o bot suspenso/fechado e não exige o termo,
  // só o entitlement de transporte "whatsapp-bot" + o módulo "ponto"
  // (processParsed corre o handler antes do gate de clientes).
  const evolutionConsumer =
    isModuleEnabled(row, "ai-inbox") ||
    (isModuleEnabled(row, "whatsapp-bot") &&
      (Boolean(row.whatsappBotDisclaimerAt) || isModuleEnabled(row, "ponto")));
  // Instalações que aceitaram o termo antes do token próprio existir:
  // gera-o aqui — o token SMS não é reutilizado (§5.7, ver rota pública).
  if (
    row.whatsappTransport === "evolution" &&
    evolutionConsumer &&
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
      evolutionConsumer &&
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
  const callbackUrl = `${base}/api/public/whatsapp/evolution/inbound`;
  const result = await setEvolutionWebhook(
    {
      apiKey,
      baseUrl: row.evolutionUrl,
      instance: row.evolutionInstance ?? "oficinaos",
    },
    {
      headers: {
        [EVOLUTION_WEBHOOK_TOKEN_HEADER]: row.evolutionWebhookToken,
      },
      url: callbackUrl,
    }
  );
  return result.success;
}
