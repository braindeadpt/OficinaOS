import {
  isWhatsAppLocalDeprecationExpired,
  isWhatsAppLocalTransitionActive,
} from "@shared/constants/whatsapp-migration.js";
import { AppError } from "@shared/errors/app-error.js";
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
import { recordWhatsAppMigrationEvent } from "./whatsapp-local-sunset.service.js";

/**
 * Where a WhatsApp message actually leaves: cloud relay or direct Graph
 * API. Shops that uploaded their Meta credentials to the cloud send via
 * POST /whatsapp/send — the entitlement is enforced server-side, so a
 * patched app can't bypass it. Shops on the legacy setup keep sending
 * directly only during the shared 30-day migration window; after it,
 * official WhatsApp either goes through the consented Cloud relay or does
 * not leave at all.
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
  whatsappLocalDeprecationStartedAt?: Date | null;
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

// Defesa em profundidade no envio: um channel resolvido antes do fim da
// transição não pode continuar a enviar Meta depois do prazo. Evolution é um
// transporte separado e não entra neste sunset.
function metaSunsetBlock(
  channel: WhatsAppChannel,
  settings: SettingsLike | null
): SendResult | null {
  if (
    channel.mode === "evolution" ||
    !isWhatsAppLocalDeprecationExpired(
      settings?.whatsappLocalDeprecationStartedAt
    )
  ) {
    return null;
  }
  if (!settings?.whatsappCloudConsentAt) {
    return {
      error: "WHATSAPP_CLOUD_AUTHORIZATION_REQUIRED",
      success: false,
    };
  }
  if (channel.mode === "local") {
    return {
      error: "WHATSAPP_LOCAL_DIRECT_SEND_ENDED",
      success: false,
    };
  }
  return null;
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

/**
 * Cloud first when credentials migrated; otherwise the legacy local config
 * only while the migration window is open. Evolution is a separate transport
 * and is not part of the Meta-direct sunset.
 */
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

  const migrationExpired = isWhatsAppLocalDeprecationExpired(
    settings.whatsappLocalDeprecationStartedAt
  );
  if (migrationExpired && !settings.whatsappCloudConsentAt) {
    // Lojas migradas antes de existir consentimento eram grandfathered só
    // durante a transição. Depois do prazo não há Meta — nem Cloud nem
    // fallback local — até autorizarem explicitamente a OficinaOS Cloud.
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
  if (migrationExpired) {
    // Sunset: mesmo com consentimento, sem credenciais válidas na Cloud não
    // existe caminho Meta direto/local — o SMS configurado é o canal reserva.
    return null;
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

type CloudFallbackReason = "cloud_http_5xx" | "cloud_network_error";
type CloudSendResult = SendResult & { fallbackReason?: CloudFallbackReason };
type LegacyLocalSender = (config: WhatsAppConfig) => Promise<SendResult>;

// Um timeout/abort é ambíguo: a Cloud pode já ter aceite a mensagem antes de
// a resposta se perder. Só falhas de estabelecimento da ligação permitem
// fallback direto sem reintroduzir um risco evitável de duplicação.
const FALLBACK_SAFE_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
]);

function networkErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") {
        return code;
      }
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
  }
  return null;
}

function canFallbackAfterNetworkError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  ) {
    return false;
  }
  const code = networkErrorCode(error);
  return code !== null && FALLBACK_SAFE_NETWORK_CODES.has(code);
}

async function sendViaCloud(
  channel: Extract<WhatsAppChannel, { mode: "cloud" }>,
  body: Record<string, unknown>
): Promise<CloudSendResult> {
  let networkFailure: unknown = null;
  const res = await cloudFetch(channel.apiUrl, "/whatsapp/send", {
    body,
    method: "POST",
    token: channel.shopToken,
    timeoutMs: 20_000,
  }).catch((error: unknown) => {
    networkFailure = error;
    return null;
  });
  if (!res) {
    return {
      error: "a aguardar ligação à cloud",
      ...(canFallbackAfterNetworkError(networkFailure)
        ? { fallbackReason: "cloud_network_error" as const }
        : {}),
      success: false,
    };
  }
  if (!res.ok) {
    const result: CloudSendResult = {
      error: cloudError(res.status, res.body),
      success: false,
    };
    // Só indisponibilidade da infraestrutura/relay permite fallback. Erros
    // definitivos de subscrição/autorização/pedido (402 e restantes 4xx)
    // nunca podem ressuscitar o envio direto legado.
    if (res.status >= 500 && res.status < 600) {
      result.fallbackReason = "cloud_http_5xx";
    }
    return result;
  }
  const messageId = (res.body as { messageId?: unknown } | null)?.messageId;
  return {
    ...(typeof messageId === "string" ? { messageId } : {}),
    success: true,
  };
}

/**
 * Fallback estritamente transitório para o token Meta local. O estado é relido
 * na hora do envio: uma revogação/limpeza concorrente ou o fim da janela não
 * podem ser contornados por um channel/settings resolvidos minutos antes.
 * Também não há envio local sem o evento persistido — a auditoria é parte do
 * próprio uso do fallback.
 */
async function tryLegacyLocalFallback(
  prisma: DbClient,
  reason: CloudFallbackReason,
  sendLocal: LegacyLocalSender
): Promise<SendResult | null> {
  let fresh: SettingsLike | null;
  try {
    fresh = await prisma.shopSettings.findUnique({
      select: {
        cloudEntitlements: true,
        cloudSyncedAt: true,
        whatsappApiTokenEncrypted: true,
        whatsappBusinessId: true,
        whatsappCredentialsAtCloud: true,
        whatsappEnabled: true,
        whatsappLocalDeprecationStartedAt: true,
        whatsappPhoneNumberId: true,
        whatsappTransport: true,
      },
      where: { id: "default" },
    });
  } catch {
    // Sem conseguir reler o estado autorizador não há fallback — falha fechada.
    return null;
  }
  if (
    !(
      fresh &&
      isModuleEnabled(fresh, "whatsapp-bot") &&
      fresh.whatsappEnabled
    ) ||
    fresh.whatsappTransport === "evolution" ||
    fresh.whatsappCredentialsAtCloud !== true ||
    !isWhatsAppLocalTransitionActive(fresh.whatsappLocalDeprecationStartedAt)
  ) {
    return null;
  }
  const config = decryptWhatsAppConfig({
    apiTokenEncrypted: fresh.whatsappApiTokenEncrypted ?? "",
    businessId: fresh.whatsappBusinessId ?? "",
    phoneNumberId: fresh.whatsappPhoneNumberId ?? "",
  });
  if (!config) {
    return null;
  }
  try {
    await recordWhatsAppMigrationEvent(prisma, "LOCAL_FALLBACK", reason);
  } catch {
    // Sem evento persistido não há fallback: a auditoria é parte do uso.
    return null;
  }
  return await sendLocal(config);
}

async function sendCloudWithLegacyFallback(
  prisma: DbClient,
  channel: Extract<WhatsAppChannel, { mode: "cloud" }>,
  body: Record<string, unknown>,
  sendLocal: LegacyLocalSender
): Promise<SendResult> {
  const cloudResult = await sendViaCloud(channel, body);
  const { fallbackReason, ...publicCloudResult } = cloudResult;
  if (cloudResult.success || !fallbackReason) {
    return publicCloudResult;
  }
  return (
    (await tryLegacyLocalFallback(prisma, fallbackReason, sendLocal)) ??
    publicCloudResult
  );
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
  const sunsetBlock = metaSunsetBlock(channel, settings);
  if (sunsetBlock) {
    return sunsetBlock;
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
  return await sendCloudWithLegacyFallback(
    prisma,
    channel,
    {
      text: message,
      to: formatPhone(to, countryCode),
    },
    (config) => sendWhatsApp(config, to, message, countryCode)
  );
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
  const sunsetBlock = metaSunsetBlock(channel, settings);
  if (sunsetBlock) {
    return sunsetBlock;
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
  return await sendCloudWithLegacyFallback(
    prisma,
    channel,
    {
      interactive,
      to: formatPhone(to, countryCode),
    },
    (config) =>
      sendWhatsAppInteractiveMessage(config, to, interactive, countryCode)
  );
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
interface PushCredentialsOptions {
  surfaceInvalidCredentials?: boolean;
}

function cloudErrorCode(body: unknown): string | null {
  if (!(body && typeof body === "object" && "error" in body)) {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

async function pushCredentialsToCloudOnce(
  prisma: DbClient,
  options: PushCredentialsOptions = {}
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
    // credenciais atuais"; um token local residual é só o fallback
    // transitório da migração até ao purge depois do prazo.
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
    // Caminhos de recuperação por resposta da Cloud (contrato em
    // oficinaos-cloud/src/routes/whatsapp.ts):
    // - 400 INVALID_BODY/INVALID_CREDENTIALS: o par token+phone_number_id é
    //   rejeitado; a loja corrige o ID ou roda o token, o save repõe a flag e
    //   esta fila reenvia o snapshot novo.
    // - 401/403: o token da loja na Cloud foi revogado/substituído; o
    //   re-pairing grava um token novo e o próximo ciclo reenvia.
    // - 402: o módulo ficou inativo; a reativação na subscrição permite a
    //   próxima tentativa. 429/5xx/rede são transitórios — o poller é a rede.
    // - 409 PHONE_NUMBER_ID_TAKEN: outra loja na Cloud detém este
    //   phone_number_id. Reenviar o mesmo pedido só resolve depois de o ID ser
    //   libertado lá; corrigir o ID localmente também rota as credenciais.
    //   Nunca marcamos o upload como atual — a flag já está false neste ramo,
    //   por isso o envio legado continua disponível durante a transição.
    // No save explícito o 400 de validação da Meta sobe para a UI; no poller
    // continua silencioso porque o aviso persistente das definições é o local
    // certo para o mostrar sem interromper ciclos em background.
    const code = cloudErrorCode(res?.body);
    if (
      options.surfaceInvalidCredentials &&
      res?.status === 400 &&
      (code === "INVALID_CREDENTIALS" || code === "INVALID_BODY")
    ) {
      throw new AppError("CLOUD_INVALID_CREDENTIALS");
    }
    return false;
  }
  // O upload demora e a loja pode gravar um token/phone_number_id de
  // substituição entretanto. Marcar a migração só se a row ainda tiver o
  // snapshot enviado à Cloud; caso contrário a Cloud ficaria com as
  // credenciais antigas mas a flag diria que tem as atuais.
  const marked = await prisma.shopSettings.updateMany({
    data: { whatsappCredentialsAtCloud: true },
    where: {
      id: "default",
      whatsappApiTokenEncrypted: rawToken,
      whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
    },
  });
  return marked.count > 0;
}

// O save das definições, o poller e a revogação podem mexer nas credenciais
// em simultâneo. Uma única fila process-wide garante que cada operação relê o
// estado atual quando arranca e que a Cloud recebe as mutações por ordem —
// caso contrário um upload antigo mais lento podia terminar depois de um
// token novo (ou depois do DELETE da revogação) e repor credenciais obsoletas.
let credentialsMutationQueue: Promise<void> = Promise.resolve();

function enqueueCredentialsMutation<T>(
  operation: () => Promise<T>
): Promise<T> {
  const run = credentialsMutationQueue.then(operation);
  credentialsMutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function pushCredentialsToCloud(
  prisma: DbClient,
  options: PushCredentialsOptions = {}
): Promise<boolean> {
  return enqueueCredentialsMutation(() =>
    pushCredentialsToCloudOnce(prisma, options)
  );
}

/**
 * Revoga a cópia das credenciais Meta guardada na Cloud. A limpeza local só
 * acontece depois de a Cloud confirmar (2xx) ou responder 404 — esse 404 é
 * idempotente porque significa que a cópia já lá não está. Em rede/5xx/outro
 * erro nada é apagado localmente: a loja nunca fica sem o token local enquanto
 * a Cloud possa ainda ter a cópia.
 */
async function revokeWhatsAppCloudCredentialsOnce(
  prisma: DbClient
): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  const shopToken = decryptSecret(settings.cloudShopTokenEncrypted);
  if (!shopToken) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  const res = await cloudFetch(
    settings.cloudApiUrl,
    "/shops/whatsapp-credentials",
    { method: "DELETE", token: shopToken }
  ).catch(() => null);
  if (!res) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  if (!(res.ok || res.status === 404)) {
    throw new AppError("CLOUD_REQUEST_FAILED", { status: res.status });
  }

  // A revogação é uma retirada explícita do consentimento e tem de ganhar
  // a qualquer gravação concorrente: se uma substituição ficasse de fora,
  // o upload seguinte na fila podia re-migrar silenciosamente com o aceite
  // antigo. Voltar ao relay exige introduzir um token novo e consentir outra
  // vez. O telefone/ID Meta ficam configurados para essa reativação; o
  // segredo local é removido.
  await prisma.shopSettings.updateMany({
    data: {
      whatsappApiTokenEncrypted: null,
      whatsappApiTokenWrittenAt: null,
      whatsappCloudConsentAt: null,
      whatsappCredentialsAtCloud: false,
    },
    where: { id: "default" },
  });
}

export function revokeWhatsAppCloudCredentials(
  prisma: DbClient
): Promise<void> {
  return enqueueCredentialsMutation(() =>
    revokeWhatsAppCloudCredentialsOnce(prisma)
  );
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
  const sunsetBlock = metaSunsetBlock(channel, settings);
  if (sunsetBlock) {
    return sunsetBlock;
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
  return await sendCloudWithLegacyFallback(
    prisma,
    channel,
    {
      template: { language: languageCode, name: templateName, params },
      to: formatPhone(to, countryCode),
    },
    (config) =>
      sendWhatsAppTemplate(
        config,
        to,
        templateName,
        languageCode,
        params,
        countryCode
      )
  );
}
