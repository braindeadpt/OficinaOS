import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import { toSmsText } from "@shared/utils/gsm7.js";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { isModuleEnabled } from "../utils/modules.js";
import {
  type BotReplyCtx,
  handleInboundMessage,
  isStopText,
  revokeConsentForPhone,
} from "./bot-intents.js";
import { recordInboundMessage } from "./inbox.service.js";
import type { NotifyContext } from "./job.service.js";
import { formatPhone } from "./notification-sender.js";

/**
 * Canal SMS local via SMS Gateway for Android em modo Local Server
 * (sms-gate.app / capcom6). O telemóvel da loja expõe uma API HTTP na
 * LAN: a app envia com POST /message (Basic auth) e recebe inbound
 * através de um webhook que regista no próprio aparelho. Nada passa
 * pela cloud — o único "sair da loja" é o SMS na rede móvel.
 * Decisão 2026-11-23: todo o SMS é Pro — este gateway fica como
 * fallback LAN do caminho Cloud e exige o módulo "sms" fresco, na
 * resolução da config (outbox) e nas rotas.
 */

const TRAILING_SLASH_RE = /\/+$/;

export interface SmsConfig {
  password: string;
  url: string;
  user: string;
}

export interface SendResult {
  error?: string;
  success: boolean;
}

function authHeader(config: SmsConfig): string {
  return `Basic ${Buffer.from(`${config.user}:${config.password}`).toString(
    "base64"
  )}`;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(TRAILING_SLASH_RE, "");
}

export function decryptSmsConfig(encrypted: {
  gatewayPasswordEncrypted: string | null;
  gatewayUrl: string | null;
  gatewayUser: string | null;
}): SmsConfig | null {
  if (
    !(
      encrypted.gatewayUrl &&
      encrypted.gatewayUser &&
      encrypted.gatewayPasswordEncrypted
    )
  ) {
    return null;
  }
  const password = isEncrypted(encrypted.gatewayPasswordEncrypted)
    ? decryptSecret(encrypted.gatewayPasswordEncrypted)
    : encrypted.gatewayPasswordEncrypted;
  if (!password) {
    return null;
  }
  return {
    password,
    url: normalizeUrl(encrypted.gatewayUrl),
    user: encrypted.gatewayUser,
  };
}

export async function sendSms(
  config: SmsConfig,
  to: string,
  text: string,
  countryCode?: string
): Promise<SendResult> {
  assertNotDemoMode();
  const url = `${config.url}/message`;
  const payload = {
    phoneNumbers: [formatPhone(to, countryCode)],
    textMessage: { text },
  };

  try {
    const response = await fetch(url, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: authHeader(config),
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return { success: true };
    }
    const body = await response.text();
    return {
      success: false,
      error: `SMS gateway ${response.status}: ${body.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Liveness probe do gateway — GET /health existe no modo Local Server. */
export async function checkSmsGateway(config: SmsConfig): Promise<SendResult> {
  assertNotDemoMode();
  try {
    const response = await fetch(`${config.url}/health`, {
      headers: { Authorization: authHeader(config) },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      return { success: true };
    }
    return { success: false, error: `Gateway respondeu ${response.status}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gateway inalcançável",
    };
  }
}

export function generateSmsWebhookToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Processa um SMS recebido no gateway LAN: compõe a resposta via intents
 * partilhados (regras determinísticas; IA só quando o módulo "sms" está
 * ativo) e responde pelo gateway. A resposta sai transliterada para
 * GSM-7 — respostas automáticas nunca devem pagar UCS-2 (§E.11).
 */
export async function handleInboundSms(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  fromPhone: string,
  text: string
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  // Defesa em profundidade: a rota já gateia, mas uma resposta do bot
  // é um envio — grátis não envia nada (decisão 2026-11-23). "ai-inbox"
  // sem "sms" entra: só grava na caixa de entrada, nunca responde.
  if (
    !(
      settings.smsEnabled &&
      (isModuleEnabled(settings, "sms") ||
        isModuleEnabled(settings, "ai-inbox"))
    )
  ) {
    return;
  }
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[]).filter(
        (m): m is string => typeof m === "string"
      )
    : [];
  const inboxEnabled = isModuleEnabled(settings, "ai-inbox");
  // §G.7 (paralelo SMS): com "ai-inbox" mas sem o módulo "sms" o inbound
  // grava-se na caixa de entrada — o bot não responde. PARAR/STOP é a
  // exceção legal: revoga consentimento mesmo sem módulo.
  if (inboxEnabled && !isModuleEnabled(settings, "sms")) {
    await recordInboundMessage(prisma, log, {
      channel: "sms",
      phone: fromPhone,
      text,
    }).catch((err) => log.warn({ err }, "sms: inbox record falhou"));
    if (isStopText(text)) {
      await revokeConsentForPhone(prisma, fromPhone).catch(() => undefined);
    }
    return;
  }
  const config = decryptSmsConfig({
    gatewayPasswordEncrypted: settings.smsGatewayPasswordEncrypted,
    gatewayUrl: settings.smsGatewayUrl,
    gatewayUser: settings.smsGatewayUser,
  });
  if (!config) {
    return;
  }

  const cloudToken = settings.cloudShopTokenEncrypted
    ? decryptSecret(settings.cloudShopTokenEncrypted)
    : null;

  const ctx: BotReplyCtx = {
    ai:
      cloudToken && settings.cloudApiUrl
        ? {
            apiUrl: settings.cloudApiUrl,
            avgRepairDaysAfterPart: settings.botAvgRepairDaysAfterPart,
            botInfoText: settings.botInfoText,
            channel: "sms",
            enabled: settings.botAiEnabled,
            module: "sms",
            modules,
            shopId: settings.cloudShopId,
            token: cloudToken,
          }
        : undefined,
    currency: settings.currency ?? "EUR",
    inbox: { channel: "sms", enabled: inboxEnabled },
    log,
    notifyCtx,
    portalApiUrl: settings.cloudApiUrl,
    portalEnabled: modules.includes("portal"),
    prisma,
    timezone: settings.timezone ?? undefined,
    shopLabel:
      [settings.shopName, settings.phone].filter(Boolean).join(" · ") ||
      "a loja",
  };
  const msg = {
    createdAt: new Date().toISOString(),
    fromPhone,
    id: `sms-${Date.now()}`,
    messageType: "text",
    text,
  };

  try {
    await handleInboundMessage(ctx, msg, {
      channelLabel: "SMS",
      // Livro de ponto: transport=sms — evaluate direto, sempre
      // POR_VALIDAR (sem localização); user.pontoSmsAllowed é o gate.
      ponto: { transport: "sms" },
      plainText: true,
      send: async (replyText) => {
        const res = await sendSms(
          config,
          fromPhone,
          toSmsText(replyText),
          settings.countryCode ?? undefined
        );
        if (!res.success) {
          log.warn({ err: res.error, to: fromPhone }, "sms-bot reply failed");
        }
        return res.success;
      },
    });
  } catch (err) {
    log.warn({ err, fromPhone }, "sms-bot inbound failed");
  }
}
