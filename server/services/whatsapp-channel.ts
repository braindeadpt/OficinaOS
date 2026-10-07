import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { cloudFetch } from "./cloud.service.js";
import {
  decryptWhatsAppConfig,
  formatPhone,
  sendWhatsApp,
  sendWhatsAppTemplate,
  type WhatsAppConfig,
} from "./notification-sender.js";

/**
 * Where a WhatsApp message actually leaves: cloud relay or direct Graph
 * API. Shops that uploaded their Meta credentials to the cloud send via
 * POST /whatsapp/send — the entitlement is enforced server-side, so a
 * patched app can't bypass it. Shops on the legacy setup keep sending
 * directly until their credentials migrate.
 */
export type WhatsAppChannel =
  | { apiUrl: string; mode: "cloud"; shopToken: string }
  | { config: WhatsAppConfig; mode: "local" };

interface SettingsLike {
  cloudApiUrl?: string | null;
  cloudShopTokenEncrypted?: string | null;
  whatsappApiTokenEncrypted?: string | null;
  whatsappBusinessId?: string | null;
  whatsappCredentialsAtCloud?: boolean | null;
  whatsappEnabled?: boolean | null;
  whatsappPhoneNumberId?: string | null;
}

export interface SendResult {
  error?: string;
  success: boolean;
}

/** Cloud first when credentials migrated; otherwise the legacy local config. */
export function resolveWhatsAppChannel(
  settings: SettingsLike
): WhatsAppChannel | null {
  if (!settings.whatsappEnabled) {
    return null;
  }
  if (
    settings.whatsappCredentialsAtCloud &&
    settings.cloudApiUrl &&
    settings.cloudShopTokenEncrypted
  ) {
    const shopToken = decryptSecret(settings.cloudShopTokenEncrypted);
    if (shopToken) {
      return {
        apiUrl: settings.cloudApiUrl,
        mode: "cloud",
        shopToken,
      };
    }
  }
  const config = decryptWhatsAppConfig({
    apiTokenEncrypted: settings.whatsappApiTokenEncrypted ?? "",
    businessId: settings.whatsappBusinessId ?? "",
    phoneNumberId: settings.whatsappPhoneNumberId ?? "",
  });
  return config ? { config, mode: "local" } : null;
}

function cloudError(status: number, body: unknown): string {
  const msg = (body as { error?: { message?: string } } | null)?.error?.message;
  if (status === 402) {
    return "O módulo WhatsApp não está ativo na subscrição.";
  }
  if (status === 409) {
    return "Credenciais WhatsApp em falta na cloud — repete o setup.";
  }
  return msg ?? `Cloud devolveu ${status}`;
}

async function sendViaCloud(
  channel: Extract<WhatsAppChannel, { mode: "cloud" }>,
  body: Record<string, unknown>
): Promise<SendResult> {
  const res = await cloudFetch(channel.apiUrl, "/whatsapp/send", {
    body,
    method: "POST",
    token: channel.shopToken,
    timeoutMs: 20_000,
  }).catch(() => null);
  if (!res) {
    return { error: "a aguardar ligação à cloud", success: false };
  }
  if (!res.ok) {
    return { error: cloudError(res.status, res.body), success: false };
  }
  return { success: true };
}

/**
 * The local token only exists for the migration window — once a cloud
 * send succeeds, it serves no purpose and deleting it closes the bypass.
 */
async function clearMigratedLocalToken(
  prisma: DbClient,
  settings: SettingsLike | null
): Promise<void> {
  if (!settings?.whatsappApiTokenEncrypted) {
    return;
  }
  try {
    await prisma.shopSettings.update({
      data: { whatsappApiTokenEncrypted: null },
      where: { id: "default" },
    });
  } catch {
    // best-effort: a limpeza repete-se no próximo envio bem-sucedido
  }
}

export async function sendWhatsAppText(
  prisma: DbClient,
  channel: WhatsAppChannel,
  to: string,
  message: string,
  countryCode: string | undefined,
  settings: SettingsLike | null
): Promise<SendResult> {
  if (channel.mode === "local") {
    return sendWhatsApp(channel.config, to, message, countryCode);
  }
  const res = await sendViaCloud(channel, {
    text: message,
    to: formatPhone(to, countryCode),
  });
  if (res.success) {
    await clearMigratedLocalToken(prisma, settings);
  }
  return res;
}

/** "+351912345678" → "+351***5678" — logs nunca levam o número completo. */
export function maskPhone(to: string): string {
  const digits = to.replace(/\D/g, "");
  if (digits.length <= 6) {
    return "***";
  }
  return `+${digits.slice(0, 3)}***${digits.slice(-4)}`;
}

/**
 * Uploads the shop's Meta credentials to the cloud relay. Runs on every
 * WhatsApp settings save so existing installs migrate without a separate
 * step. Returns true when the cloud accepted them — on false the legacy
 * local send path keeps working (no data lost).
 */
export async function pushCredentialsToCloud(
  prisma: DbClient
): Promise<boolean> {
  const settings = await getOrCreateShopSettings(prisma);
  if (
    !(
      settings.cloudApiUrl &&
      settings.cloudShopTokenEncrypted &&
      settings.whatsappPhoneNumberId &&
      settings.whatsappApiTokenEncrypted
    )
  ) {
    return Boolean(settings.whatsappCredentialsAtCloud);
  }
  if (settings.whatsappCredentialsAtCloud) {
    return true;
  }
  const shopToken = decryptSecret(settings.cloudShopTokenEncrypted);
  const rawToken = settings.whatsappApiTokenEncrypted;
  const accessToken = isEncrypted(rawToken)
    ? decryptSecret(rawToken)
    : rawToken;
  if (!(shopToken && accessToken)) {
    return false;
  }
  const res = await cloudFetch(
    settings.cloudApiUrl,
    "/shops/whatsapp-credentials",
    {
      body: {
        accessToken,
        phoneNumberId: settings.whatsappPhoneNumberId,
      },
      method: "POST",
      token: shopToken,
    }
  ).catch(() => null);
  if (!res?.ok) {
    return false;
  }
  await prisma.shopSettings.update({
    data: { whatsappCredentialsAtCloud: true },
    where: { id: "default" },
  });
  return true;
}

export async function sendWhatsAppTemplateVia(
  prisma: DbClient,
  channel: WhatsAppChannel,
  to: string,
  templateName: string,
  languageCode: string,
  params: string[],
  countryCode: string | undefined,
  settings: SettingsLike | null
): Promise<SendResult> {
  if (channel.mode === "local") {
    return sendWhatsAppTemplate(
      channel.config,
      to,
      templateName,
      languageCode,
      params,
      countryCode
    );
  }
  const res = await sendViaCloud(channel, {
    template: { language: languageCode, name: templateName, params },
    to: formatPhone(to, countryCode),
  });
  if (res.success) {
    await clearMigratedLocalToken(prisma, settings);
  }
  return res;
}
