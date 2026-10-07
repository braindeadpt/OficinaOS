import type { PrismaClient } from "@generated/client";
import type {
  UpdateAiSettingsInput,
  UpdateInvoicingSettingsInput,
  UpdateNotificationTemplateInput,
  UpdateShopSettingsInput,
  UpdateSmsSettingsInput,
  UpdateWhatsAppSettingsInput,
} from "@shared/schemas/settings.schema";
import { decryptSecret, encryptSecret, isEncrypted } from "../lib/crypto.js";
import { findNotificationTemplateUnique } from "../repositories/notification.repository.js";
import {
  findAiSettingsUnique,
  findManyNotificationTemplates,
  findShopSettingsUnique,
  updateNotificationTemplate as updateNotificationTemplateRepo,
  upsertAiSettings as upsertAiSettingsRepo,
  upsertShopSettings as upsertShopSettingsRepo,
} from "../repositories/settings.repository.js";
import { generateSmsWebhookToken } from "./sms.service.js";

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

const shopCreate = (input: UpdateShopSettingsInput) => ({
  address: input.address ?? null,
  countryCode: input.countryCode ?? "PT",
  currency: input.currency ?? "EUR",
  id: "default",
  phone: input.phone ?? null,
  receiptFooter: input.receiptFooter ?? null,
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
  monthlyRevenueGoal: input.monthlyRevenueGoal ?? null,
  reviewUrl: input.reviewUrl?.trim() || null,
  shopName: input.shopName,
});

const shopUpdate = (input: UpdateShopSettingsInput) => ({
  address: input.address,
  countryCode: input.countryCode,
  currency: input.currency,
  phone: input.phone,
  receiptFooter: input.receiptFooter,
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
  monthlyRevenueGoal:
    input.monthlyRevenueGoal === undefined
      ? undefined
      : input.monthlyRevenueGoal || null,
  reviewUrl:
    input.reviewUrl === undefined ? undefined : input.reviewUrl.trim() || null,
  shopName: input.shopName,
});

export async function upsertShopSettings(
  prisma: PrismaClient,
  input: UpdateShopSettingsInput
) {
  return await upsertShopSettingsRepo(prisma, {
    create: shopCreate(input),
    update: shopUpdate(input),
    where: { id: "default" },
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
  const existing = await findNotificationTemplateUnique(prisma, id);
  if (!existing) {
    return null;
  }

  return await updateNotificationTemplateRepo(prisma, id, {
    body: input.body,
    channel: input.channel,
    isDefault: input.isDefault,
    name: input.name,
  });
}

export async function testAiConnection(prisma: PrismaClient) {
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

export async function getWhatsAppSettings(prisma: PrismaClient) {
  const row = await findShopSettingsUnique(prisma);
  if (!row) {
    return {
      businessId: null,
      credentialsAtCloud: false,
      enabled: false,
      hasApiToken: false,
      phoneNumberId: null,
      remarketingCooldownDays: 180,
      remarketingDays: 90,
      remarketingEnabled: false,
      remarketingModule: false,
      remarketingTemplate: null,
      trackingBaseUrl: null,
    };
  }
  const modules = Array.isArray(row.cloudEntitlements)
    ? (row.cloudEntitlements as string[])
    : [];
  return {
    businessId: row.whatsappBusinessId,
    credentialsAtCloud: row.whatsappCredentialsAtCloud,
    enabled: row.whatsappEnabled,
    hasApiToken: Boolean(row.whatsappApiTokenEncrypted),
    phoneNumberId: row.whatsappPhoneNumberId,
    remarketingCooldownDays: row.remarketingCooldownDays,
    remarketingDays: row.remarketingDays,
    remarketingEnabled: row.remarketingEnabled,
    remarketingModule: modules.includes("remarketing"),
    remarketingTemplate: row.remarketingTemplate,
    trackingBaseUrl: row.trackingBaseUrl,
  };
}

export async function upsertWhatsAppSettings(
  prisma: PrismaClient,
  input: UpdateWhatsAppSettingsInput
) {
  const data: {
    remarketingCooldownDays?: number;
    remarketingDays?: number;
    remarketingEnabled?: boolean;
    remarketingTemplate?: string | null;
    trackingBaseUrl?: string | null;
    whatsappApiTokenEncrypted?: string;
    whatsappBusinessId?: string;
    whatsappEnabled?: boolean;
    whatsappPhoneNumberId?: string;
  } = {};
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
  }

  return await upsertShopSettingsRepo(prisma, {
    create: {
      id: "default",
      shopName: "",
      trackingBaseUrl: data.trackingBaseUrl ?? null,
      whatsappApiTokenEncrypted: data.whatsappApiTokenEncrypted ?? null,
      whatsappBusinessId: data.whatsappBusinessId ?? null,
      whatsappEnabled: data.whatsappEnabled ?? false,
      whatsappPhoneNumberId: data.whatsappPhoneNumberId ?? null,
    },
    update: data,
    where: { id: "default" },
  });
}

export async function getSmsSettings(prisma: PrismaClient) {
  const row = await findShopSettingsUnique(prisma);
  return {
    enabled: row?.smsEnabled ?? false,
    gatewayUrl: row?.smsGatewayUrl ?? null,
    gatewayUser: row?.smsGatewayUser ?? null,
    hasPassword: Boolean(row?.smsGatewayPasswordEncrypted),
    // Path do webhook inbound — o host depende de como o staff acede à
    // app; a UI compõe o URL completo com window.location.origin.
    inboundPath: row?.smsWebhookToken
      ? `/api/public/sms/inbound/${row.smsWebhookToken}`
      : null,
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
    if (input.enabled) {
      // Token novo no enable garante um path inbound inesperável mesmo
      // que o anterior tenha sido exposto — gerado sempre que se ativa.
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
  const modules = Array.isArray(row?.cloudEntitlements)
    ? (row.cloudEntitlements as string[])
    : [];
  return {
    account: row?.invoicingAccount ?? null,
    enabled: row?.invoicingEnabled ?? false,
    hasApiKey: Boolean(row?.invoicingApiKeyEncrypted),
    module: modules.includes("invoicing"),
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
