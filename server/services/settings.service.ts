const TRAILING_SLASH = /\/$/;

import { OutboxStatus, type PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  UpdateAiSettingsInput,
  UpdateInvoicingSettingsInput,
  UpdateNotificationTemplateInput,
  UpdateShopSettingsInput,
  UpdateSmsSettingsInput,
  UpdateWhatsAppSettingsInput,
} from "@shared/schemas/settings.schema";
import { decryptSecret, encryptSecret, isEncrypted } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import { findNotificationTemplateUnique } from "../repositories/notification.repository.js";
import {
  findAiSettingsUnique,
  findManyNotificationTemplates,
  findShopSettingsUnique,
  updateNotificationTemplate as updateNotificationTemplateRepo,
  upsertAiSettings as upsertAiSettingsRepo,
  upsertShopSettings as upsertShopSettingsRepo,
} from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { isModuleEnabled } from "../utils/modules.js";
import { cloudFetch } from "./cloud.service.js";
import { STAFF_INITIATED_TEMPLATES } from "./notification-outbox.service.js";
import { generateSmsWebhookToken } from "./sms.service.js";
import { templateStatusOf } from "./whatsapp-templates.service.js";

// Variáveis sem as quais o modelo staff-initiated sai inútil —
// o pedido de assinatura sem {{signUrl}} não tem ligação para abrir.
const REQUIRED_TEMPLATE_VARS: Record<string, string> = {
  signature_link: "signUrl",
};

function endpointOrigin(endpoint: string) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return endpoint;
  }
}

function publicAiSettings<
  T extends { apiKeyEncrypted: string } | null | undefined,
>(row: T) {
  if (!row) {
    return null;
  }
  const { apiKeyEncrypted, ...rest } = row;
  return { ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
}

export async function getAiSettings(prisma: PrismaClient) {
  const row = await findAiSettingsUnique(prisma);
  return publicAiSettings(row);
}

export async function getRawAiSettings(prisma: PrismaClient) {
  return await findAiSettingsUnique(prisma);
}

export async function upsertAiSettings(
  prisma: PrismaClient,
  input: UpdateAiSettingsInput
) {
  const data: Record<string, unknown> = {};
  const previous =
    input.endpointUrl === undefined ? null : await findAiSettingsUnique(prisma);
  const providerChanged = Boolean(
    previous?.endpointUrl &&
      input.endpointUrl !== undefined &&
      endpointOrigin(previous.endpointUrl) !== endpointOrigin(input.endpointUrl)
  );
  if (input.endpointUrl !== undefined) {
    data.endpointUrl = input.endpointUrl;
  }
  if (input.apiKey !== undefined && input.apiKey !== "") {
    data.apiKeyEncrypted = encryptSecret(input.apiKey);
  }
  if (input.model !== undefined) {
    data.model = input.model;
  }
  if (input.temperature !== undefined) {
    data.temperature = input.temperature;
  }

  const shouldAutoEnable =
    input.endpointUrl && input.apiKey && input.enabled === undefined;

  if (input.enabled !== undefined || shouldAutoEnable) {
    data.enabled = input.enabled ?? true;
  }

  if (providerChanged && !input.apiKey) {
    data.apiKeyEncrypted = "";
    data.enabled = false;
  }
  const row = await upsertAiSettingsRepo(prisma, {
    create: {
      apiKeyEncrypted: (data.apiKeyEncrypted as string) ?? "",
      enabled: (data.enabled as boolean) ?? false,
      endpointUrl: (data.endpointUrl as string) ?? "",
      id: "default",
      model: (data.model as string | null) ?? null,
      temperature: (data.temperature as number) ?? 0.7,
    },
    update: data,
    where: { id: "default" },
  });
  return publicAiSettings(row);
}

export async function getShopSettings(prisma: PrismaClient) {
  const row = await findShopSettingsUnique(prisma);
  if (!row) {
    return row;
  }
  // Never expose the encrypted cloud shop token through the settings API.
  const { cloudShopTokenEncrypted: _cloudToken, ...rest } = row;
  return rest;
}

const ORIGIN_LIST_SPLIT = /[\s,]+/;

/** One canonical origin per line; empty/whitespace clears the setting. */
function normalizeOriginList(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const origins = value
    .split(ORIGIN_LIST_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).origin;
      } catch {
        return null;
      }
    })
    .filter((o): o is string => o !== null);
  return origins.length > 0 ? Array.from(new Set(origins)).join("\n") : null;
}

const botCreate = (input: UpdateShopSettingsInput) => ({
  botAiEnabled: input.botAiEnabled ?? false,
  botAvgRepairDaysAfterPart: input.botAvgRepairDaysAfterPart ?? 1,
  botClosedFallbackText: input.botClosedFallbackText?.trim() || null,
  botInfoText: input.botInfoText?.trim() || null,
});

const botUpdate = (input: UpdateShopSettingsInput) => ({
  botAiEnabled: input.botAiEnabled,
  botAvgRepairDaysAfterPart: input.botAvgRepairDaysAfterPart,
  botClosedFallbackText:
    input.botClosedFallbackText === undefined
      ? undefined
      : input.botClosedFallbackText?.trim() || null,
  botInfoText:
    input.botInfoText === undefined
      ? undefined
      : input.botInfoText?.trim() || null,
});

// Livro de ponto (Pro "ponto") — geolocalização da loja, raio do registo e
// opções de externos/lembretes. Tal como botCreate/botUpdate, mantido
// fora do shopCreate/shopUpdate para não disparar a complexidade.
const pontoCreate = (input: UpdateShopSettingsInput) => ({
  pontoGeoLat: input.pontoGeoLat ?? null,
  pontoGeoLng: input.pontoGeoLng ?? null,
  pontoRadiusM: input.pontoRadiusM ?? 100,
  pontoExternalAutoApprove: input.pontoExternalAutoApprove ?? true,
  pontoExternalPhotoRequired: input.pontoExternalPhotoRequired ?? false,
  pontoExitReminderTime: input.pontoExitReminderTime?.trim() || null,
  pontoPauseReminderMinutes: input.pontoPauseReminderMinutes ?? 20,
  pontoInfoText: input.pontoInfoText?.trim() || null,
  pontoWaNumber: input.pontoWaNumber?.trim() || null,
  pontoSmsNumber: input.pontoSmsNumber?.trim() || null,
});

const pontoUpdate = (input: UpdateShopSettingsInput) => ({
  pontoGeoLat: input.pontoGeoLat,
  pontoGeoLng: input.pontoGeoLng,
  pontoRadiusM: input.pontoRadiusM,
  pontoExternalAutoApprove: input.pontoExternalAutoApprove,
  pontoExternalPhotoRequired: input.pontoExternalPhotoRequired,
  pontoExitReminderTime:
    input.pontoExitReminderTime === undefined
      ? undefined
      : input.pontoExitReminderTime?.trim() || null,
  pontoPauseReminderMinutes: input.pontoPauseReminderMinutes,
  pontoInfoText:
    input.pontoInfoText === undefined
      ? undefined
      : input.pontoInfoText?.trim() || null,
  pontoWaNumber:
    input.pontoWaNumber === undefined
      ? undefined
      : input.pontoWaNumber?.trim() || null,
  pontoSmsNumber:
    input.pontoSmsNumber === undefined
      ? undefined
      : input.pontoSmsNumber?.trim() || null,
});

const shopCreate = (input: UpdateShopSettingsInput) => ({
  address: input.address ?? null,
  countryCode: input.countryCode ?? "PT",
  currency: input.currency ?? "EUR",
  id: "default",
  phone: input.phone ?? null,
  receiptFooter: input.receiptFooter ?? null,
  inboxRetentionDays: input.inboxRetentionDays ?? 365,
  intakeTerms: input.intakeTerms?.trim() || null,
  ...botCreate(input),
  receiptPaper: input.receiptPaper ?? "80mm",
  receiptShowImei: input.receiptShowImei ?? true,
  receiptShowProblem: input.receiptShowProblem ?? true,
  receiptShowSignature: input.receiptShowSignature ?? true,
  receiptShowQr: input.receiptShowQr ?? true,
  receiptShowWarranty: input.receiptShowWarranty ?? true,
  labelSize: input.labelSize ?? "40x20",
  printerMode: input.printerMode ?? "browser",
  printerHost: input.printerHost ?? null,
  printerPort: input.printerPort ?? 9100,
  printerHighContrast: input.printerHighContrast ?? false,
  monthlyRevenueGoal: input.monthlyRevenueGoal ?? null,
  reviewUrl: input.reviewUrl?.trim() || null,
  embedAllowedOrigins: normalizeOriginList(input.embedAllowedOrigins),
  ...pontoCreate(input),
  shopName: input.shopName,
});

const shopUpdate = (input: UpdateShopSettingsInput) => ({
  address: input.address,
  countryCode: input.countryCode,
  currency: input.currency,
  phone: input.phone,
  receiptFooter: input.receiptFooter,
  inboxRetentionDays: input.inboxRetentionDays,
  intakeTerms:
    input.intakeTerms === undefined
      ? undefined
      : input.intakeTerms.trim() || null,
  ...botUpdate(input),
  receiptPaper: input.receiptPaper,
  receiptShowImei: input.receiptShowImei,
  receiptShowProblem: input.receiptShowProblem,
  receiptShowSignature: input.receiptShowSignature,
  receiptShowQr: input.receiptShowQr,
  receiptShowWarranty: input.receiptShowWarranty,
  labelSize: input.labelSize,
  printerMode: input.printerMode,
  printerHost: input.printerHost,
  printerPort: input.printerPort,
  printerHighContrast: input.printerHighContrast,
  monthlyRevenueGoal:
    input.monthlyRevenueGoal === undefined
      ? undefined
      : input.monthlyRevenueGoal || null,
  reviewUrl:
    input.reviewUrl === undefined ? undefined : input.reviewUrl.trim() || null,
  embedAllowedOrigins:
    input.embedAllowedOrigins === undefined
      ? undefined
      : normalizeOriginList(input.embedAllowedOrigins),
  ...pontoUpdate(input),
  shopName: input.shopName,
});

export async function upsertShopSettings(
  prisma: PrismaClient,
  input: UpdateShopSettingsInput
) {
  const saved = await upsertShopSettingsRepo(prisma, {
    create: shopCreate(input),
    update: shopUpdate(input),
    where: { id: "default" },
  });
  // O texto "loja fechada" também vive na Cloud — o fallback do §E.10
  // corre lá quando o PC está desligado. Fire-and-forget: uma falha de
  // rede nunca bloqueia o save local (a Cloud fica com o último valor
  // que chegou; o próximo save volta a empurrar).
  if (input.botClosedFallbackText !== undefined) {
    pushClosedTextToCloud(prisma, input.botClosedFallbackText).catch(
      () => null
    );
  }
  return saved;
}

async function pushClosedTextToCloud(
  prisma: PrismaClient,
  text: string | null
): Promise<void> {
  const settings = await prisma.shopSettings.findUnique({
    select: { cloudApiUrl: true, cloudShopTokenEncrypted: true },
    where: { id: "default" },
  });
  if (!(settings?.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    return;
  }
  const token = decryptSecret(settings.cloudShopTokenEncrypted);
  if (!token) {
    return;
  }
  await cloudFetch(settings.cloudApiUrl, "/shops/bot-settings", {
    body: { closedFallbackText: text?.trim() || null },
    method: "PUT",
    token,
  });
}

export async function getNotificationTemplates(prisma: PrismaClient) {
  return await findManyNotificationTemplates(prisma);
}

export async function updateNotificationTemplate(
  prisma: PrismaClient,
  id: string,
  input: UpdateNotificationTemplateInput
) {
  // Update + migração na mesma transação — duas edições concorrentes
  // não deixam metade da fila num nome que o editor já não mostra.
  return await prisma.$transaction(async (tx) => {
    const existing = await findNotificationTemplateUnique(tx, id);
    if (!existing) {
      return null;
    }

    // O nome reservado transporta semântica de envio manual — entradas
    // com ele saltam o gate de consentimento no outbox. Renomear um
    // modelo PARA ele apropriava-se desse privilégio; editar o modelo
    // signature_link em si (nome inalterado) continua a funcionar.
    if (
      input.name &&
      input.name !== existing.name &&
      STAFF_INITIATED_TEMPLATES.has(input.name)
    ) {
      throw new AppError("VALIDATION_ERROR", {
        errors: { name: ["reserved_name"] },
      });
    }

    // Variáveis obrigatórias por modelo staff-initiated: sem {{signUrl}}
    // o pedido de assinatura sai sem a ligação que o cliente precisa
    // para abrir o documento — a mensagem chega mas não serve. O canal
    // IN_APP é a confirmação para o staff e deliberadamente não leva link.
    const requiredVar =
      (input.channel ?? existing.channel) === "IN_APP"
        ? undefined
        : REQUIRED_TEMPLATE_VARS[input.name || existing.name];
    if (
      requiredVar &&
      !(input.body ?? existing.body ?? "").includes(requiredVar)
    ) {
      throw new AppError("VALIDATION_ERROR", {
        errors: { body: [`missing_${requiredVar}`] },
      });
    }

    const updated = await updateNotificationTemplateRepo(tx, id, {
      body: input.body,
      channel: input.channel,
      isDefault: input.isDefault,
      name: input.name,
    });

    // Rename dentro de WHATSAPP: a fila migra só quando o nome antigo
    // NÃO está APPROVED — se está, a Meta mantém o modelo e as entradas
    // drenam por ele, e migrar para um nome em revisão expirava avisos
    // que iam a tempo. Um nome sem aprovação nunca é reconsultado pelo
    // sync — migrar é a única via de a aprovação do nome novo chegar à
    // fila.
    const renamedInWhatsapp =
      input.name &&
      input.name !== existing.name &&
      existing.channel === "WHATSAPP" &&
      updated.channel === "WHATSAPP";
    if (renamedInWhatsapp) {
      const settings = await findShopSettingsUnique(tx);
      if (templateStatusOf(settings, existing.name) !== "APPROVED") {
        await migrateQueuedToRenamed(tx, existing.name, input.name);
      }
    }

    return updated;
  });
}

/**
 * Move entradas QUEUED para o nome novo — vars recomputam a ordem pelo
 * corpo atual no envio; entries só-posicionais (formato antigo) ficam
 * sob o nome antigo, que a Meta mantém. nextRetryAt/error limpos: um
 * nome já aprovado não deve esperar o ciclo de adiamento.
 */
async function migrateQueuedToRenamed(
  tx: DbClient,
  oldName: string,
  newName: string
): Promise<void> {
  const queued = await tx.notificationOutbox.findMany({
    select: { id: true, templateParams: true },
    where: {
      channel: "WHATSAPP",
      status: OutboxStatus.QUEUED,
      templateName: oldName,
    },
  });
  for (const q of queued) {
    const p = q.templateParams;
    const migratable =
      p === null ||
      (!Array.isArray(p) &&
        typeof p === "object" &&
        typeof (p as { vars?: unknown }).vars === "object");
    if (migratable) {
      await tx.notificationOutbox.update({
        data: { error: null, nextRetryAt: null, templateName: newName },
        where: { id: q.id },
      });
    }
  }
}

export async function testAiConnection(prisma: PrismaClient) {
  assertNotDemoMode();
  const settings = await findAiSettingsUnique(prisma);
  if (!settings) {
    return { message: "AI settings not configured", success: false };
  }
  if (!settings.endpointUrl) {
    return { message: "Endpoint URL is not set", success: false };
  }

  // The URL is fetched server-side: only http(s) endpoints are probed, and
  // redirects are not followed (a redirect could launder the probe to a
  // different internal address than the one the owner configured).
  let endpoint: URL;
  try {
    endpoint = new URL(settings.endpointUrl);
  } catch {
    return { message: "Endpoint URL is not valid", success: false };
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    return {
      message: "Endpoint URL must use http or https",
      success: false,
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (settings.apiKeyEncrypted) {
      const apiKey = isEncrypted(settings.apiKeyEncrypted)
        ? decryptSecret(settings.apiKeyEncrypted)
        : settings.apiKeyEncrypted;
      if (!apiKey) {
        return {
          message: "Stored API key could not be decrypted",
          success: false,
        };
      }
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (
      !endpoint.pathname
        .replace(TRAILING_SLASH, "")
        .endsWith("/chat/completions")
    ) {
      endpoint.pathname = `${endpoint.pathname.replace(TRAILING_SLASH, "")}/chat/completions`;
    }
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        max_tokens: 1,
        messages: [{ content: "ping", role: "user" }],
        model: settings.model ?? "gpt-4",
      }),
      headers,
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return { message: "Connection successful", success: true };
    }
    return {
      message: `HTTP ${response.status}: ${response.statusText}`,
      success: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { message, success: false };
  }
}

interface WhatsAppDeprecationWarningRow {
  whatsappApiTokenEncrypted: string | null;
  whatsappCloudConsentAt: Date | null;
  whatsappCredentialsAtCloud: boolean;
  whatsappLocalDeprecationWarnedAt: Date | null;
}

/**
 * Marca o início da transição de 30 dias do envio Meta direto/local.
 * O aviso aparece quando há token local por migrar e ainda não há
 * consentimento Cloud; o timestamp é imutável porque a contagem da
 * transição não pode reiniciar em cada gravação ou refresh da UI.
 */
async function markWhatsAppLocalDeprecationWarningOnce(
  prisma: PrismaClient,
  row: WhatsAppDeprecationWarningRow
): Promise<Date | null> {
  const existing = row.whatsappLocalDeprecationWarnedAt ?? null;
  const needsWarning = Boolean(
    row.whatsappApiTokenEncrypted &&
      !row.whatsappCredentialsAtCloud &&
      !row.whatsappCloudConsentAt
  );
  if (!needsWarning || existing) {
    return existing;
  }
  const warnedAt = new Date();
  const result = await prisma.shopSettings.updateMany({
    data: { whatsappLocalDeprecationWarnedAt: warnedAt },
    where: { id: "default", whatsappLocalDeprecationWarnedAt: null },
  });
  if (result.count === 0) {
    // Outro request ganhou a corrida — o valor dele é o início canónico
    // da transição, não o nosso timestamp concorrente.
    const fresh = await findShopSettingsUnique(prisma);
    return fresh?.whatsappLocalDeprecationWarnedAt ?? warnedAt;
  }
  return warnedAt;
}

export async function getWhatsAppSettings(prisma: PrismaClient) {
  const row = await findShopSettingsUnique(prisma);
  if (!row) {
    return {
      botDailyCap: 200,
      botDisclaimerAccepted: false,
      botSuspendedAt: null,
      businessId: null,
      cloudConsentAccepted: false,
      credentialsAtCloud: false,
      disclaimerAccepted: false,
      enabled: false,
      evolutionInstance: null,
      evolutionUrl: null,
      hasApiToken: false,
      hasEvolutionApiKey: false,
      localDeprecationWarnedAt: null,
      phoneNumberId: null,
      remarketingCooldownDays: 180,
      remarketingDays: 90,
      remarketingEnabled: false,
      remarketingModule: false,
      pickupReminderTemplate: null,
      remarketingTemplate: null,
      trackingBaseUrl: null,
      transport: "meta",
      whatsappModule: false,
    };
  }
  const localDeprecationWarnedAt =
    await markWhatsAppLocalDeprecationWarningOnce(prisma, row);
  return {
    botDailyCap: row.whatsappBotDailyCap,
    botDisclaimerAccepted: Boolean(row.whatsappBotDisclaimerAt),
    botSuspendedAt: row.whatsappBotSuspendedAt,
    businessId: row.whatsappBusinessId,
    cloudConsentAccepted: Boolean(row.whatsappCloudConsentAt),
    credentialsAtCloud: row.whatsappCredentialsAtCloud,
    disclaimerAccepted: Boolean(row.whatsappLocalDisclaimerAt),
    enabled: row.whatsappEnabled,
    evolutionInstance: row.evolutionInstance,
    evolutionUrl: row.evolutionUrl,
    hasApiToken: Boolean(row.whatsappApiTokenEncrypted),
    hasEvolutionApiKey: Boolean(row.evolutionApiKeyEncrypted),
    localDeprecationWarnedAt,
    phoneNumberId: row.whatsappPhoneNumberId,
    remarketingCooldownDays: row.remarketingCooldownDays,
    remarketingDays: row.remarketingDays,
    remarketingEnabled: row.remarketingEnabled,
    remarketingModule: isModuleEnabled(row, "remarketing"),
    pickupReminderTemplate: row.pickupReminderTemplate,
    remarketingTemplate: row.remarketingTemplate,
    trackingBaseUrl: row.trackingBaseUrl,
    transport: row.whatsappTransport,
    whatsappModule: isModuleEnabled(row, "whatsapp-bot"),
  };
}

interface WhatsAppUpsertData {
  evolutionApiKeyEncrypted?: string;
  evolutionInstance?: string | null;
  evolutionUrl?: string | null;
  pickupReminderTemplate?: string | null;
  remarketingCooldownDays?: number;
  remarketingDays?: number;
  remarketingEnabled?: boolean;
  remarketingTemplate?: string | null;
  trackingBaseUrl?: string | null;
  whatsappApiTokenEncrypted?: string;
  whatsappBotDailyCap?: number;
  whatsappBotDisclaimerAt?: Date;
  whatsappBotDisclaimerUserId?: string | null;
  whatsappBotSuspendedAt?: Date | null;
  whatsappBusinessId?: string;
  whatsappCredentialsAtCloud?: boolean;
  whatsappEnabled?: boolean;
  whatsappLocalDisclaimerAt?: Date;
  whatsappPhoneNumberId?: string;
  whatsappTransport?: string;
}

/** Campos do transporte local (Evolution) — separados para baixar a complexidade do upsert. */
function applyEvolutionFields(
  data: WhatsAppUpsertData,
  input: UpdateWhatsAppSettingsInput,
  userId?: string
): void {
  if (input.transport !== undefined) {
    data.whatsappTransport = input.transport;
  }
  if (input.evolutionUrl !== undefined) {
    data.evolutionUrl = input.evolutionUrl.trim() || null;
  }
  if (input.evolutionInstance !== undefined) {
    data.evolutionInstance = input.evolutionInstance.trim() || null;
  }
  if (input.evolutionApiKey !== undefined && input.evolutionApiKey !== "") {
    data.evolutionApiKeyEncrypted = encryptSecret(input.evolutionApiKey);
  }
  if (input.disclaimerAccepted === true) {
    // Timestamp do aceite — o transporte local só resolve com ele.
    data.whatsappLocalDisclaimerAt = new Date();
  }
  if (input.botDisclaimerAccepted === true) {
    // Termo do bot (§5.7) — separado do disclaimer do transporte.
    // Re-aceitar também desfaz a suspensão automática por erro de sessão.
    data.whatsappBotDisclaimerAt = new Date();
    data.whatsappBotDisclaimerUserId = userId ?? null;
    data.whatsappBotSuspendedAt = null;
  }
  if (input.botDailyCap !== undefined) {
    data.whatsappBotDailyCap = input.botDailyCap;
  }
}

/**
 * Regista o consentimento Cloud Meta uma única vez. O timestamp é parte
 * da auditoria do aceite e não pode ser reiniciado por PUTs repetidos ou
 * por uma corrida entre dois requests concorrentes.
 */
async function recordWhatsAppCloudConsentOnce(
  prisma: PrismaClient,
  consentInput: boolean | undefined,
  current: Date | null
): Promise<Date | null> {
  if (consentInput !== true || current) {
    return current;
  }
  const consentAt = new Date();
  const result = await prisma.shopSettings.updateMany({
    data: { whatsappCloudConsentAt: consentAt },
    where: { id: "default", whatsappCloudConsentAt: null },
  });
  if (result.count !== 0) {
    return consentAt;
  }
  // Outro request ganhou a corrida — preserva o aceite canónico.
  const fresh = await findShopSettingsUnique(prisma);
  return fresh?.whatsappCloudConsentAt ?? consentAt;
}

export async function upsertWhatsAppSettings(
  prisma: PrismaClient,
  input: UpdateWhatsAppSettingsInput,
  userId?: string
) {
  const data: WhatsAppUpsertData = {};
  if (input.enabled !== undefined) {
    data.whatsappEnabled = input.enabled;
  }
  if (input.remarketingEnabled !== undefined) {
    data.remarketingEnabled = input.remarketingEnabled;
  }
  if (input.remarketingDays !== undefined) {
    data.remarketingDays = input.remarketingDays;
  }
  if (input.remarketingCooldownDays !== undefined) {
    data.remarketingCooldownDays = input.remarketingCooldownDays;
  }
  if (input.pickupReminderTemplate !== undefined) {
    data.pickupReminderTemplate = input.pickupReminderTemplate || null;
  }
  if (input.remarketingTemplate !== undefined) {
    data.remarketingTemplate = input.remarketingTemplate || null;
  }
  if (input.businessId !== undefined) {
    data.whatsappBusinessId = input.businessId;
  }
  if (input.phoneNumberId !== undefined) {
    data.whatsappPhoneNumberId = input.phoneNumberId;
  }
  if (input.trackingBaseUrl !== undefined) {
    data.trackingBaseUrl = input.trackingBaseUrl.trim() || null;
  }
  if (input.apiToken !== undefined && input.apiToken !== "") {
    data.whatsappApiTokenEncrypted = encryptSecret(input.apiToken);
    // Um token novo ainda não está na Cloud. Repor a flag aqui é o que
    // permite um re-upload futuro; enquanto a flag estiver true, o push
    // pode tratar o token local residual como o mesmo já migrado.
    data.whatsappCredentialsAtCloud = false;
  }
  applyEvolutionFields(data, input, userId);

  // O webhook inbound da Evolution tem segredo próprio, separado do
  // SMS — partilhá-lo dava a quem lê a config do webhook na Evolution a
  // credencial que autentica envios SMS (decisões de orçamento), e a
  // rotação do token SMS ao gravar o gateway partia o callback do bot.
  // Gera-se ao aceitar o termo, sem rodar um token já emitido.
  if (input.botDisclaimerAccepted === true) {
    await prisma.shopSettings.updateMany({
      data: { evolutionWebhookToken: generateSmsWebhookToken() },
      where: { id: "default", evolutionWebhookToken: null },
    });
  }

  const updated = await upsertShopSettingsRepo(prisma, {
    create: whatsAppCreateData(data),
    update: data as Record<string, unknown>,
    where: { id: "default" },
  });

  const whatsappCloudConsentAt = await recordWhatsAppCloudConsentOnce(
    prisma,
    input.cloudConsent,
    updated.whatsappCloudConsentAt ?? null
  );

  const whatsappLocalDeprecationWarnedAt =
    await markWhatsAppLocalDeprecationWarningOnce(prisma, {
      ...updated,
      whatsappCloudConsentAt,
    });

  return {
    ...updated,
    whatsappCloudConsentAt,
    whatsappLocalDeprecationWarnedAt,
  };
}

function whatsAppCreateData(data: WhatsAppUpsertData) {
  return {
    evolutionApiKeyEncrypted: data.evolutionApiKeyEncrypted ?? null,
    evolutionInstance: data.evolutionInstance ?? null,
    evolutionUrl: data.evolutionUrl ?? null,
    id: "default",
    shopName: "",
    trackingBaseUrl: data.trackingBaseUrl ?? null,
    whatsappApiTokenEncrypted: data.whatsappApiTokenEncrypted ?? null,
    whatsappBusinessId: data.whatsappBusinessId ?? null,
    whatsappEnabled: data.whatsappEnabled ?? false,
    whatsappLocalDisclaimerAt: data.whatsappLocalDisclaimerAt ?? null,
    whatsappPhoneNumberId: data.whatsappPhoneNumberId ?? null,
    whatsappTransport: data.whatsappTransport ?? "meta",
  };
}

export async function getSmsSettings(prisma: PrismaClient) {
  const row = await findShopSettingsUnique(prisma);
  return {
    enabled: row?.smsEnabled ?? false,
    gatewayUrl: row?.smsGatewayUrl ?? null,
    gatewayUser: row?.smsGatewayUser ?? null,
    hasPassword: Boolean(row?.smsGatewayPasswordEncrypted),
    // Todo o SMS é Pro (decisão 2026-11-23) — moduleEnabled reflete o
    // módulo "sms" fresco e a UI mostra o card locked sem ele; o
    // gateway LAN é apenas o fallback do caminho Cloud.
    moduleEnabled: isModuleEnabled(row, "sms"),
  };
}

export async function upsertSmsSettings(
  prisma: PrismaClient,
  input: UpdateSmsSettingsInput
) {
  const data: {
    smsEnabled?: boolean;
    smsGatewayUrl?: string | null;
    smsGatewayUser?: string | null;
    smsGatewayPasswordEncrypted?: string;
    smsWebhookToken?: string;
  } = {};
  if (input.enabled !== undefined) {
    data.smsEnabled = input.enabled;
  }
  // O token só muda quando pedido (rotateWebhookToken) ou quando falta —
  // um save de rotina (ativar, trocar a URL do gateway…) regenerava-o e
  // a URL inbound no Android morria silenciosamente até ser regravada.
  if (input.rotateWebhookToken) {
    data.smsWebhookToken = generateSmsWebhookToken();
  } else if (input.enabled) {
    const current = await findShopSettingsUnique(prisma);
    // Instalações antigas partilhavam este segredo com o webhook da
    // Evolution — tokens iguais significam que uma cópia continua a
    // autenticar SMS de entrada. Ao reativar o gateway (off→on) roda-se
    // o token para invalidar a cópia partilhada.
    const reactivating = current != null && current.smsEnabled === false;
    const sharedWithEvolution =
      current?.smsWebhookToken != null &&
      current.smsWebhookToken === current.evolutionWebhookToken;
    if (!current?.smsWebhookToken || (reactivating && sharedWithEvolution)) {
      data.smsWebhookToken = generateSmsWebhookToken();
    }
  }
  if (input.gatewayUrl !== undefined) {
    data.smsGatewayUrl = input.gatewayUrl.trim() || null;
  }
  if (input.gatewayUser !== undefined) {
    data.smsGatewayUser = input.gatewayUser.trim() || null;
  }
  if (input.gatewayPassword !== undefined && input.gatewayPassword !== "") {
    data.smsGatewayPasswordEncrypted = encryptSecret(input.gatewayPassword);
  }

  return await upsertShopSettingsRepo(prisma, {
    create: {
      id: "default",
      shopName: "",
      smsEnabled: data.smsEnabled ?? false,
      smsGatewayPasswordEncrypted: data.smsGatewayPasswordEncrypted ?? null,
      smsGatewayUrl: data.smsGatewayUrl ?? null,
      smsGatewayUser: data.smsGatewayUser ?? null,
      smsWebhookToken: data.smsWebhookToken ?? null,
    },
    update: data,
    where: { id: "default" },
  });
}

export async function getInvoicingSettings(prisma: PrismaClient) {
  const row = await findShopSettingsUnique(prisma);
  return {
    account: row?.invoicingAccount ?? null,
    enabled: row?.invoicingEnabled ?? false,
    hasApiKey: Boolean(row?.invoicingApiKeyEncrypted),
    module: isModuleEnabled(row, "invoicing"),
    taxName: row?.invoicingTaxName ?? "IVA23",
  };
}

export async function upsertInvoicingSettings(
  prisma: PrismaClient,
  input: UpdateInvoicingSettingsInput
) {
  const data: {
    invoicingAccount?: string | null;
    invoicingApiKeyEncrypted?: string;
    invoicingEnabled?: boolean;
    invoicingTaxName?: string;
  } = {};
  if (input.enabled !== undefined) {
    data.invoicingEnabled = input.enabled;
  }
  if (input.account !== undefined) {
    data.invoicingAccount = input.account.trim() || null;
  }
  if (input.taxName !== undefined) {
    data.invoicingTaxName = input.taxName.trim() || "IVA23";
  }
  if (input.apiKey) {
    data.invoicingApiKeyEncrypted = encryptSecret(input.apiKey);
  }

  return await upsertShopSettingsRepo(prisma, {
    create: {
      id: "default",
      invoicingAccount: data.invoicingAccount ?? null,
      invoicingApiKeyEncrypted: data.invoicingApiKeyEncrypted ?? null,
      invoicingEnabled: data.invoicingEnabled ?? false,
      invoicingTaxName: data.invoicingTaxName ?? "IVA23",
      shopName: "",
    },
    update: data,
    where: { id: "default" },
  });
}
