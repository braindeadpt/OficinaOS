import { COUNTRY_DIAL_CODES } from "@shared/constants/countries.js";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";

interface WhatsAppConfig {
  apiToken: string;
  businessId: string;
  phoneNumberId: string;
}

interface SendResult {
  error?: string;
  /** Graph API error code when the failure carried one. */
  errorCode?: number;
  /**
   * Explicit retry policy for the failure. Undefined means "retry by
   * default" (network errors, unexpected shapes); false marks permanent
   * failures that the outbox must cancel instead of re-queueing.
   */
  retryable?: boolean;
  success: boolean;
}

interface GraphErrorBody {
  error?: {
    code?: number;
    error_data?: { details?: string };
    message?: string;
    type?: string;
  };
}

/** Token/auth problems: retrying with the same token cannot succeed. */
const AUTH_ERROR_CODES = new Set([190]);
/** Recipient unreachable or outside the 24h window: permanent. */
const RECIPIENT_ERROR_CODES = new Set([131_026, 131_030, 131_047]);
/** Cloud API throttling: backing off and retrying is the right move. */
const RATE_LIMIT_CODES = new Set([130_429, 80_007]);

const TRAILING_SLASHES = /\/+$/;

/**
 * Test seam: the Graph API base URL can be pointed at a local mock
 * server (integration tests). Production keeps the real endpoint.
 */
function graphApiBase(): string {
  const raw = process.env.WHATSAPP_GRAPH_BASE_URL?.trim();
  if (!raw) {
    return "https://graph.facebook.com";
  }
  return raw.replace(TRAILING_SLASHES, "");
}

function classifyFailure(
  status: number,
  body: GraphErrorBody | null
): { errorCode?: number; retryable: boolean } {
  const code = body?.error?.code;
  if (
    status === 429 ||
    (code !== undefined && RATE_LIMIT_CODES.has(code)) ||
    status >= 500
  ) {
    return { errorCode: code, retryable: true };
  }
  if (
    (code !== undefined && AUTH_ERROR_CODES.has(code)) ||
    (code !== undefined && RECIPIENT_ERROR_CODES.has(code))
  ) {
    return { errorCode: code, retryable: false };
  }
  if (status >= 400 && status < 500) {
    // Other client errors: the payload is rejected as-is, retrying the
    // identical request cannot succeed.
    return { errorCode: code, retryable: false };
  }
  return { errorCode: code, retryable: true };
}

export async function sendWhatsApp(
  config: WhatsAppConfig,
  to: string,
  message: string,
  countryCode?: string
): Promise<SendResult> {
  const url = `${graphApiBase()}/v21.0/${config.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(to, countryCode),
    type: "text",
    text: { body: message },
  };

  try {
    const response = await fetch(url, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return { success: true };
    }
    const body = await response.text();
    let parsed: GraphErrorBody | null = null;
    try {
      parsed = JSON.parse(body) as GraphErrorBody;
    } catch {
      // Plain-text error body (proxy pages, empty responses) — classify
      // from the HTTP status alone.
    }
    return {
      error: `WhatsApp API ${response.status}: ${body.slice(0, 200)}`,
      ...classifyFailure(response.status, parsed),
      success: false,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export function decryptWhatsAppConfig(encrypted: {
  apiTokenEncrypted: string;
  businessId: string;
  phoneNumberId: string;
}): WhatsAppConfig | null {
  if (
    !(
      encrypted.apiTokenEncrypted &&
      encrypted.phoneNumberId &&
      encrypted.businessId
    )
  ) {
    return null;
  }
  const apiToken = isEncrypted(encrypted.apiTokenEncrypted)
    ? decryptSecret(encrypted.apiTokenEncrypted)
    : encrypted.apiTokenEncrypted;
  if (!apiToken) {
    return null;
  }
  return {
    apiToken,
    businessId: encrypted.businessId,
    phoneNumberId: encrypted.phoneNumberId,
  };
}

export function formatPhone(phone: string, countryCode?: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, "");
  const dialCode =
    countryCode && COUNTRY_DIAL_CODES[countryCode]
      ? COUNTRY_DIAL_CODES[countryCode]
      : "351";
  if (digits.startsWith("0")) {
    return `+${dialCode}${digits.slice(1)}`;
  }
  return `+${digits}`;
}
