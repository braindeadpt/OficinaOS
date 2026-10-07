import {
  COUNTRY_DIAL_CODES,
  NATIONAL_NUMBER_LENGTHS,
} from "@shared/constants/countries.js";
import { decryptSecret, isEncrypted } from "../lib/crypto.js";

export interface WhatsAppConfig {
  apiToken: string;
  businessId: string;
  phoneNumberId: string;
}

interface SendResult {
  error?: string;
  success: boolean;
}

export async function sendWhatsApp(
  config: WhatsAppConfig,
  to: string,
  message: string,
  countryCode?: string
): Promise<SendResult> {
  const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
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
    return {
      success: false,
      error: `WhatsApp API ${response.status}: ${body.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Business-initiated WhatsApp outside the 24h window must be a Meta
 * template message — freeform text is rejected by the Graph API.
 * `params` map to the template's positional body variables ({{1}}, {{2}}…).
 */
export async function sendWhatsAppTemplate(
  config: WhatsAppConfig,
  to: string,
  templateName: string,
  languageCode: string,
  params: string[],
  countryCode?: string
): Promise<SendResult> {
  const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(to, countryCode),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: "body",
          parameters: params.map((text) => ({ type: "text", text })),
        },
      ],
    },
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
    return {
      success: false,
      error: `WhatsApp API ${response.status}: ${body.slice(0, 200)}`,
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
  if (digits.startsWith("00")) {
    // International prefix without "+": 00351912… → +351912…
    return `+${digits.slice(2)}`;
  }
  if (digits.startsWith("0")) {
    return `+${dialCode}${digits.slice(1)}`;
  }
  const nationalLen = NATIONAL_NUMBER_LENGTHS[countryCode ?? ""] ?? 9;
  if (digits.length <= nationalLen) {
    // Bare national number — the common entry format (912345678).
    return `+${dialCode}${digits}`;
  }
  // Longer than a national number: already carries a country code
  // (with or without ours) — just needs the "+".
  return `+${digits}`;
}
