import { decryptSecret, isEncrypted } from "../lib/crypto.js";
import { assertNotDemoMode } from "../lib/demo.js";
import { formatPhone } from "./notification-sender.js";

/**
 * Transporte SMS "custom" (free): a loja descreve a API do provider dela —
 * URL + headers (Authorization e afins, cifrado em repouso) + body
 * template JSON com placeholders {{to}} e {{text}}. Suporta POST em
 * application/json ou application/x-www-form-urlencoded e GET com os
 * campos renderizados em query params. Cobre a maioria dos gateways HTTP
 * (BulkSMS, Go4Mobility, agregadores nacionais) sem adapter dedicado.
 *
 * Limites assumidos (documentados em docs/ecosystem.md):
 * - Outbound only — o formato de webhook inbound é específico de cada
 *   provider e não é genericizável; respostas do cliente só existem no
 *   transporte "android" (sms-gate) ou via relay cloud.
 * - Sucesso = resposta 2xx que contenha smsCustomSuccessText quando
 *   configurado (muitos gateways devolvem 200 com erro dentro do body).
 */

const PLACEHOLDER_RE = /\{\{(to|text)\}\}/g;
const SEND_TIMEOUT_MS = 15_000;

export interface CustomSmsConfig {
  bodyFormat: "form" | "json";
  bodyTemplate: Record<string, unknown>;
  headers: Record<string, string>;
  method: "GET" | "POST";
  successText: string | null;
  url: string;
}

interface SendResult {
  error?: string;
  success: boolean;
}

interface CustomSettingsLike {
  smsCustomBodyFormat?: string | null;
  smsCustomBodyTemplate?: string | null;
  smsCustomHeadersEncrypted?: string | null;
  smsCustomMethod?: string | null;
  smsCustomSuccessText?: string | null;
  smsCustomUrl?: string | null;
  smsTransport?: string | null;
}

/** O template tem de ter {{to}} e {{text}} algures nos valores string. */
export function templateHasPlaceholders(template: Record<string, unknown>): {
  text: boolean;
  to: boolean;
} {
  const found = { text: false, to: false };
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.includes("{{to}}")) {
        found.to = true;
      }
      if (value.includes("{{text}}")) {
        found.text = true;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        walk(item);
      }
    }
  };
  walk(template);
  return found;
}

/**
 * Substitui {{to}}/{{text}} dentro dos valores string DEPOIS do parse —
 * o texto pode conter aspas ou barras sem partir o JSON serializado.
 */
export function renderTemplate(
  template: Record<string, unknown>,
  vars: { text: string; to: string }
): Record<string, unknown> {
  const render = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(PLACEHOLDER_RE, (_, key: string) =>
        key === "to" ? vars.to : vars.text
      );
    }
    if (Array.isArray(value)) {
      return value.map(render);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, render(v)])
      );
    }
    return value;
  };
  return render(template) as Record<string, unknown>;
}

/**
 * Valida o JSON de template no save: tem de ser um objeto com os dois
 * placeholders. Devolve o objeto parseado ou null — a rota traduz em
 * AppError antes de gravar.
 */
export function parseCustomTemplate(
  raw: string
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const found = templateHasPlaceholders(obj);
  return found.to && found.text ? obj : null;
}

export function resolveCustomSmsConfig(
  settings: CustomSettingsLike
): CustomSmsConfig | null {
  if (
    settings.smsTransport !== "custom" ||
    !(settings.smsCustomUrl && settings.smsCustomBodyTemplate)
  ) {
    return null;
  }
  const bodyTemplate = parseCustomTemplate(settings.smsCustomBodyTemplate);
  if (!bodyTemplate) {
    return null;
  }
  let headers: Record<string, string> = {};
  if (settings.smsCustomHeadersEncrypted) {
    const raw = isEncrypted(settings.smsCustomHeadersEncrypted)
      ? decryptSecret(settings.smsCustomHeadersEncrypted)
      : settings.smsCustomHeadersEncrypted;
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
            k,
            String(v),
          ])
        );
      }
    } catch {
      headers = {};
    }
  }
  const method = settings.smsCustomMethod === "GET" ? "GET" : "POST";
  const bodyFormat = settings.smsCustomBodyFormat === "form" ? "form" : "json";
  return {
    bodyFormat,
    bodyTemplate,
    headers,
    method,
    successText: settings.smsCustomSuccessText || null,
    url: settings.smsCustomUrl.trim(),
  };
}

export async function sendCustomSms(
  config: CustomSmsConfig,
  to: string,
  text: string,
  countryCode?: string
): Promise<SendResult> {
  assertNotDemoMode();
  const rendered = renderTemplate(config.bodyTemplate, {
    text,
    to: formatPhone(to, countryCode),
  });
  const flat = Object.fromEntries(
    Object.entries(rendered).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ])
  );

  let url = config.url;
  const init: RequestInit = { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) };
  if (config.method === "GET") {
    const query = new URLSearchParams(flat);
    url += `${url.includes("?") ? "&" : "?"}${query}`;
    init.method = "GET";
    init.headers = config.headers;
  } else if (config.bodyFormat === "form") {
    init.method = "POST";
    init.headers = {
      ...config.headers,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    init.body = new URLSearchParams(flat).toString();
  } else {
    init.method = "POST";
    init.headers = { ...config.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(rendered);
  }

  try {
    const response = await fetch(url, init);
    const body = await response.text();
    if (!response.ok) {
      return {
        success: false,
        error: `SMS provider ${response.status}: ${body.slice(0, 200)}`,
      };
    }
    if (config.successText && !body.includes(config.successText)) {
      return {
        success: false,
        error: `SMS provider respondeu sem "${config.successText}" no corpo`,
      };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
