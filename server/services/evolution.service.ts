/**
 * Evolution API (v2) — transporte WhatsApp local Pro. Corre num
 * container na LAN da loja (Baileys / WhatsApp Web multi-device); não é
 * a API oficial Meta e pode resultar em ban do número — daí o
 * disclaimer obrigatório antes de ativar. Decisão 2026-11-23: toda a
 * mensagem WhatsApp é Pro — este transporte exige o módulo
 * "whatsapp-bot" como os restantes (Meta local + relay cloud).
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
import { assertNotDemoMode } from "../lib/demo.js";
import { isModuleEnabled } from "../utils/modules.js";

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
  assertNotDemoMode();
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
  text: string,
  settings: {
    cloudEntitlements?: unknown;
    cloudSyncedAt?: Date | null;
  } | null
): Promise<{ error?: string; messageId?: string; success: boolean }> {
  // Demo bloqueia qualquer saída antes de se olhar para o entitlement.
  assertNotDemoMode();
  // Defesa em profundidade: o resolve já gateia o canal, mas uma
  // revogação entre a resolução e o envio não passa — sem o módulo
  // "whatsapp-bot" fresco não sai texto pela Evolution.
  if (!isModuleEnabled(settings, "whatsapp-bot")) {
    return {
      error: "Módulo whatsapp-bot não está ativo (OficinaOS Pro)",
      success: false,
    };
  }
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
  // O key.id permite correlacionar um reply-quote inbound (stanzaId)
  // com a mensagem enviada — livro de ponto.
  const messageId = (res.body as { key?: { id?: string } } | null)?.key?.id;
  return { ...(messageId ? { messageId } : {}), success: true };
}

/** Presença "a escrever…" antes da resposta do bot (§5.7) — best-effort. */
export async function sendEvolutionPresence(
  config: EvolutionConfig,
  to: string,
  delayMs: number
): Promise<void> {
  await evoFetch(
    config.baseUrl,
    config.apiKey,
    `/chat/sendPresence/${config.instance}`,
    {
      body: {
        number: toDigits(to),
        options: { delay: delayMs, presence: "composing" },
      },
      method: "POST",
    }
  );
}

/**
 * Download de média recebida (ponto — foto de prova): a Evolution serve
 * a mensagem original em `message` e devolve base64 + mimetype. Usado só
 * pelo handler do livro de ponto; o pipeline de clientes nunca baixa
 * anexos.
 */
export async function downloadEvolutionMedia(
  config: EvolutionConfig,
  message: unknown
): Promise<{ base64: string; mimetype?: string } | null> {
  const res = await evoFetch(
    config.baseUrl,
    config.apiKey,
    `/chat/getBase64FromMediaMessage/${config.instance}`,
    {
      body: { convertToMp4: false, message },
      method: "POST",
    }
  );
  if (!res?.ok) {
    return null;
  }
  const body = res.body as { base64?: unknown; mimetype?: unknown } | null;
  if (typeof body?.base64 !== "string" || body.base64.length === 0) {
    return null;
  }
  return {
    base64: body.base64,
    mimetype: typeof body.mimetype === "string" ? body.mimetype : undefined,
  };
}

/**
 * Header que transporta o segredo do webhook inbound — a Evolution
 * aceita `headers` custom no /webhook/set e reenvia-os em cada POST.
 * O token nunca vai no path: em HTTP remoto (domínio público) um path
 * com segredo é sniffável em trânsito; o header mantém-se igual de
 * exposto em claro, por isso hosts públicos são sempre registados em
 * HTTPS (ver tryRegisterEvolutionWebhook). A rota legada
 * /inbound/:token continua aceite para webhooks já registados.
 */
export const EVOLUTION_WEBHOOK_TOKEN_HEADER = "x-oficinaos-webhook-token";

/**
 * Regista o webhook inbound na instância — a Evolution passa a POSTar
 * MESSAGES_UPSERT ao callback (§5.7). webhookByEvents: false porque a
 * rota recebe o envelope completo e filtra o evento.
 */
export async function setEvolutionWebhook(
  config: EvolutionConfig,
  callback: { headers?: Record<string, string>; url: string }
): Promise<{ error?: string; success: boolean }> {
  const res = await evoFetch(
    config.baseUrl,
    config.apiKey,
    `/webhook/set/${config.instance}`,
    {
      body: {
        webhook: {
          enabled: true,
          events: ["MESSAGES_UPSERT"],
          url: callback.url,
          webhookBase64: false,
          webhookByEvents: false,
          ...(callback.headers ? { headers: callback.headers } : {}),
        },
      },
      method: "POST",
    }
  );
  if (!res?.ok) {
    return { error: "Evolution recusou o webhook", success: false };
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
