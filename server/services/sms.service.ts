import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import {
  type BotReplyCtx,
  composeReply,
  escalateToStaff,
  rateOk,
} from "./bot-intents.js";
import type { NotifyContext } from "./job.service.js";
import { formatPhone } from "./notification-sender.js";

/**
 * Canal SMS (core, grátis) via SMS Gateway for Android em modo Local
 * Server (sms-gate.app / capcom6). O telemóvel da loja expõe uma API HTTP
 * na LAN: a app envia com POST /message (Basic auth) e recebe inbound
 * através de um webhook que regista no próprio aparelho. Nada passa pela
 * cloud — o único "sair da loja" é o SMS na rede móvel.
 */

const TRAILING_SLASH_RE = /\/+$/;
const WEBHOOK_ID = "oficinaos-inbound";

export interface SmsConfig {
  password: string;
  url: string;
  user: string;
}

interface SendResult {
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

/**
 * Regista o webhook sms:received no telemóvel para o callbackUrl indicado.
 * Remove primeiro um registo "oficinaos-inbound" anterior — o registo é
 * idempotente e sobrevive a re-saves das settings.
 */
export async function registerSmsWebhook(
  config: SmsConfig,
  callbackUrl: string
): Promise<SendResult> {
  try {
    const listRes = await fetch(`${config.url}/webhooks`, {
      headers: { Authorization: authHeader(config) },
      signal: AbortSignal.timeout(10_000),
    });
    if (listRes.ok) {
      const hooks = (await listRes.json()) as { id: string }[];
      for (const hook of Array.isArray(hooks) ? hooks : []) {
        if (hook.id === WEBHOOK_ID) {
          await fetch(`${config.url}/webhooks/${hook.id}`, {
            headers: { Authorization: authHeader(config) },
            method: "DELETE",
            signal: AbortSignal.timeout(10_000),
          }).catch(() => null);
        }
      }
    }

    const response = await fetch(`${config.url}/webhooks`, {
      body: JSON.stringify({
        event: "sms:received",
        id: WEBHOOK_ID,
        url: callbackUrl,
      }),
      headers: {
        Authorization: authHeader(config),
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
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

export function generateSmsWebhookToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Processa um SMS recebido: compõe a resposta via intents partilhados
 * (estado da reparação, orçamento SIM/NÃO) e responde pelo gateway.
 * plainText=true — SMS não renderiza os marcadores *bold* do WhatsApp.
 */
export async function handleInboundSms(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  notifyCtx: NotifyContext | undefined,
  fromPhone: string,
  text: string
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!settings.smsEnabled) {
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
  if (!rateOk(fromPhone)) {
    return;
  }

  const ctx: BotReplyCtx = {
    currency: settings.currency ?? "EUR",
    log,
    notifyCtx,
    prisma,
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
    const out = await composeReply(ctx, msg, true);
    const res = await sendSms(
      config,
      fromPhone,
      out.text,
      settings.countryCode ?? undefined
    );
    if (!res.success) {
      log.warn({ err: res.error, to: fromPhone }, "sms-bot reply failed");
    }
    if (out.escalate) {
      await escalateToStaff(ctx, "SMS", msg, out.customerName, out.jobId).catch(
        (err) => log.warn({ err }, "sms-bot escalate failed")
      );
    }
  } catch (err) {
    log.warn({ err, fromPhone }, "sms-bot inbound failed");
  }
}
