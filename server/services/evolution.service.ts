/**
 * Evolution API (v2) — transporte WhatsApp local do módulo Pro
 * "whatsapp-bot". Corre num container na LAN da loja (Baileys /
 * WhatsApp Web multi-device); não é a API oficial Meta e pode resultar
 * em ban do número — daí o disclaimer obrigatório antes de ativar.
 *
 * Contrato validado com evoapicloud/evolution-api:v2.3.6:
 *   POST /instance/create            → cria instância (qrcode, hash)
 *   GET  /instance/connect/{name}    → QR base64 + pairingCode
 *   GET  /instance/connectionState   → { instance: { state } }
 *   POST /message/sendText/{name}    → { number, text }
 *   DELETE /instance/logout/{name}   → desliga a sessão
 * Auth: header `apikey` (global AUTHENTICATION_API_KEY ou hash da
 * instância). syncFullHistory=false — nunca guardamos histórico.
 */

export interface EvolutionConfig {
  apiKey: string;
  baseUrl: string;
  instance: string;
}

export type EvolutionState = "open" | "connecting" | "close" | "unreachable";

export interface EvolutionPairing {
  pairingCode?: string;
  qrBase64?: string;
}

const TIMEOUT_MS = 10_000;
const TRAILING_SLASH_RE = /\/+$/;
const NON_DIGIT_RE = /\D/g;

async function evoFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
  init?: { body?: unknown; method?: string }
): Promise<{ body: unknown; ok: boolean; status: number } | null> {
  try {
    const res = await fetch(
      `${baseUrl.replace(TRAILING_SLASH_RE, "")}${path}`,
      {
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          apikey: apiKey,
          ...(init?.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        method: init?.method ?? "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    const body = await res.json().catch(() => null);
    return { body, ok: res.ok, status: res.status };
  } catch {
    return null;
  }
}

/** "+351 912 345 678" → "351912345678" — Evolution quer dígitos. */
function toDigits(phone: string): string {
  return phone.replace(NON_DIGIT_RE, "");
}

export async function sendEvolutionText(
  config: EvolutionConfig,
  to: string,
  text: string
): Promise<{ error?: string; success: boolean }> {
  const res = await evoFetch(
    config.baseUrl,
    config.apiKey,
    `/message/sendText/${config.instance}`,
    {
      body: { number: toDigits(to), text },
      method: "POST",
    }
  );
  if (!res) {
    return { error: "Evolution API inacessível", success: false };
  }
  if (!res.ok) {
    const msg =
      (res.body as { response?: { message?: string[] } } | null)?.response
        ?.message?.[0] ?? (res.body as { message?: string } | null)?.message;
    return { error: msg ?? `Evolution API ${res.status}`, success: false };
  }
  return { success: true };
}

export async function getEvolutionState(
  baseUrl: string,
  apiKey: string,
  instance: string
): Promise<EvolutionState> {
  const res = await evoFetch(
    baseUrl,
    apiKey,
    `/instance/connectionState/${instance}`
  );
  if (!res?.ok) {
    return "unreachable";
  }
  const state = (res.body as { instance?: { state?: string } } | null)?.instance
    ?.state;
  if (state === "open" || state === "connecting" || state === "close") {
    return state;
  }
  return "unreachable";
}

/**
 * Cria a instância se não existir e devolve QR/pairing code para a UI.
 * syncFullHistory:false — nunca sincroniza o histórico de conversas.
 */
export async function pairEvolutionInstance(
  config: EvolutionConfig
): Promise<EvolutionPairing | { error: string }> {
  const create = await evoFetch(
    config.baseUrl,
    config.apiKey,
    "/instance/create",
    {
      body: {
        instanceName: config.instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        syncFullHistory: false,
      },
      method: "POST",
    }
  );
  if (create?.ok) {
    const body = create.body as {
      hash?: { apikey?: string } | string;
      qrcode?: { base64?: string; pairingCode?: string };
    } | null;
    return {
      pairingCode: body?.qrcode?.pairingCode,
      qrBase64: body?.qrcode?.base64,
    };
  }
  // Instância já existe (400/409) — pedir novo código de emparelhamento.
  const connect = await evoFetch(
    config.baseUrl,
    config.apiKey,
    `/instance/connect/${config.instance}`
  );
  if (connect?.ok) {
    const body = connect.body as {
      base64?: string;
      pairingCode?: string;
    } | null;
    return { pairingCode: body?.pairingCode, qrBase64: body?.base64 };
  }
  return { error: "Evolution API inacessível ou a recusar o pedido" };
}

export async function disconnectEvolutionInstance(
  config: EvolutionConfig
): Promise<{ success: boolean }> {
  const res = await evoFetch(
    config.baseUrl,
    config.apiKey,
    `/instance/logout/${config.instance}`,
    { method: "DELETE" }
  );
  return { success: Boolean(res?.ok) };
}
