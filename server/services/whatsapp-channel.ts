import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { isModuleEnabled } from "../utils/modules.js";
import { cloudFetch } from "./cloud.service.js";
import {
  type EvolutionConfig,
  sendEvolutionText,
} from "./evolution.service.js";
import {
  decryptWhatsAppConfig,
  formatPhone,
  sendWhatsApp,
  sendWhatsAppInteractiveMessage,
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
  | { config: WhatsAppConfig; mode: "local" }
  | { config: EvolutionConfig; mode: "evolution" };

interface SettingsLike {
  cloudApiUrl?: string | null;
  cloudEntitlements?: unknown;
  cloudShopTokenEncrypted?: string | null;
  cloudSyncedAt?: Date | null;
  evolutionApiKeyEncrypted?: string | null;
  evolutionInstance?: string | null;
  evolutionUrl?: string | null;
  whatsappApiTokenEncrypted?: string | null;
  whatsappBusinessId?: string | null;
  whatsappCloudConsentAt?: Date | null;
  whatsappCredentialsAtCloud?: boolean | null;
  whatsappEnabled?: boolean | null;
  whatsappLocalDisclaimerAt?: Date | null;
  whatsappPhoneNumberId?: string | null;
  whatsappTransport?: string | null;
}

export interface SendResult {
  error?: string;
  /** Id da mensagem aceite quando o provider o devolve (key.id da
   *  Evolution, wamid da Meta direta ou via relay cloud) — o livro de
   *  ponto correlaciona a resposta citada com a pergunta enviada. */
  messageId?: string;
  success: boolean;
}

/**
 * Transporte "evolution" (WhatsApp local, Pro): corre na LAN da loja e é
 * não-oficial — por isso exige o disclaimer de responsabilidade aceite,
 * além do entitlement "whatsapp-bot" (decisão 2026-11-23: toda a
 * mensagem WhatsApp é Pro). Sem disclaimer resolve para null e o outbox
 * cancela os envios.
 */
function resolveEvolutionChannel(
  settings: SettingsLike
): WhatsAppChannel | null {
  if (
    settings.whatsappTransport !== "evolution" ||
    !settings.whatsappLocalDisclaimerAt ||
    !settings.evolutionUrl
  ) {
    return null;
  }
  const apiKey = settings.evolutionApiKeyEncrypted
    ? decryptSecret(settings.evolutionApiKeyEncrypted)
    : null;
  if (!apiKey) {
    return null;
  }
  return {
    config: {
      apiKey,
      baseUrl: settings.evolutionUrl,
      instance: settings.evolutionInstance ?? "oficinaos",
    },
    mode: "evolution",
  };
}

/** Cloud first when credentials migrated; otherwise the legacy local config. */
export function resolveWhatsAppChannel(
  settings: SettingsLike
): WhatsAppChannel | null {
  // Decisão 2026-11-23: grátis não envia NADA — todo o WhatsApp (Meta
  // local, Evolution, relay cloud/oficial) exige o módulo Pro
  // "whatsapp-bot" com cache fresco (isModuleEnabled <24h).
  if (!isModuleEnabled(settings, "whatsapp-bot")) {
    return null;
  }
  if (!settings.whatsappEnabled) {
    return null;
  }
  if (settings.whatsappTransport === "evolution") {
    return resolveEvolutionChannel(settings);
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
  const messageId = (res.body as { messageId?: unknown } | null)?.messageId;
  return {
    ...(typeof messageId === "string" ? { messageId } : {}),
    success: true,
  };
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
  assertNotDemoMode();
  // Defesa em profundidade: a revogação entre o resolve e o envio não
  // passa — o cache de entitlements expira ou perde o módulo e o envio
  // falha aqui mesmo que o channel ainda exista.
  if (!isModuleEnabled(settings, "whatsapp-bot")) {
    return {
      error: "Módulo whatsapp-bot não está ativo (OficinaOS Pro)",
      success: false,
    };
  }
  if (channel.mode === "local") {
    return sendWhatsApp(channel.config, to, message, countryCode);
  }
  if (channel.mode === "evolution") {
    return sendEvolutionText(
      channel.config,
      formatPhone(to, countryCode),
      message,
      settings
    );
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

/**
 * Interactive Meta message — só o livro de ponto usa (pedido de
 * localização, botões de resposta). Evolution não tem equivalente →
 * falha explícita; o handler cai sempre em texto simples.
 */
export async function sendWhatsAppInteractive(
  prisma: DbClient,
  channel: WhatsAppChannel,
  to: string,
  interactive: Record<string, unknown>,
  countryCode: string | undefined,
  settings: SettingsLike | null
): Promise<SendResult> {
  assertNotDemoMode();
  if (!isModuleEnabled(settings, "whatsapp-bot")) {
    return {
      error: "Módulo whatsapp-bot não está ativo (OficinaOS Pro)",
      success: false,
    };
  }
  if (channel.mode === "local") {
    return sendWhatsAppInteractiveMessage(
      channel.config,
      to,
      interactive,
      countryCode
    );
  }
  if (channel.mode === "evolution") {
    return {
      error: "Mensagens interativas indisponíveis no transporte Evolution",
      success: false,
    };
  }
  const res = await sendViaCloud(channel, {
    interactive,
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
 * Uploads the shop's Meta credentials to the cloud relay. New uploads
 * require the explicit cloud-consent timestamp; installs already migrated
 * are grandfathered and keep working while PR B surfaces the retrospective
 * notice. Returns true when the cloud has the current credentials — on
 * false the legacy local send path keeps working during the transition.
 */
export async function pushCredentialsToCloud(
  prisma: DbClient
): Promise<boolean> {
  const settings = await getOrCreateShopSettings(prisma);
  // §5.6 — só lojas Pro migram para o relay cloud: sem o módulo
  // "whatsapp-bot" fresco a loja nunca envia credenciais.
  // O retorno reflete se a Cloud TEM credenciais (flag gravada), não o
  // entitlement atual — perder o módulo não apaga as credenciais lá e
  // devolver false divergiria do GET das definições.
  if (!isModuleEnabled(settings, "whatsapp-bot")) {
    return Boolean(settings.whatsappCredentialsAtCloud);
  }
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
    // Não é um early-return cego: gravar um apiToken novo repõe esta flag
    // em upsertWhatsAppSettings. Assim, true significa "a Cloud tem as
    // credenciais atuais"; um token local residual é só o fallback da
    // migração à espera de ser apagado após o primeiro envio Cloud.
    return true;
  }
  // WP0.6 — sem consentimento explícito não há upload, nem no save nem
  // pelo poller. O no-op é silencioso porque a UI é quem mostra o aviso
  // e o envio local legado continua durante a transição.
  if (!settings.whatsappCloudConsentAt) {
    return false;
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
  assertNotDemoMode();
  if (!isModuleEnabled(settings, "whatsapp-bot")) {
    return {
      error: "Módulo whatsapp-bot não está ativo (OficinaOS Pro)",
      success: false,
    };
  }
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
  // Baileys não conhece templates Meta — o remarketing precisa do modo
  // oficial. Falha explícita em vez de enviar texto por render.
  if (channel.mode === "evolution") {
    return {
      error: "Templates Meta indisponíveis no transporte local (Evolution)",
      success: false,
    };
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
