import { Prisma, type PrismaClient } from "@generated/client";
import { Role } from "@shared/constants/roles.js";
import type { FastifyBaseLogger } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { create as createIntakeRequest } from "../repositories/intake-request.repository.js";
import { findManyUsers } from "../repositories/notification.repository.js";
import { generateIntakeRequestCode } from "../utils/intake-request-code.js";
import type { NotifyContext } from "./job.service.js";
import { notify } from "./notification-dispatch.js";

const FETCH_TIMEOUT_MS = 10_000;

interface CloudErrorBody {
  error?: { code?: string; message?: string };
}

const TRAILING_SLASHES = /\/+$/;

export function errorMessage(body: unknown): string | undefined {
  const err = (body as CloudErrorBody | null)?.error;
  return err?.message ?? err?.code;
}

export async function cloudFetch(
  apiUrl: string,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string;
    timeoutMs?: number;
  } = {}
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? FETCH_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${apiUrl.replace(TRAILING_SLASHES, "")}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export interface CloudStatus {
  apiUrl: string | null;
  modules: string[];
  paired: boolean;
  reachable: boolean | null;
  shopId: string | null;
  shopName: string | null;
  syncedAt: string | null;
}

function toStatus(settings: {
  cloudApiUrl: string | null;
  cloudShopTokenEncrypted: string | null;
  cloudShopId: string | null;
  cloudShopName: string | null;
  cloudEntitlements: unknown;
  cloudSyncedAt: Date | null;
}): CloudStatus {
  return {
    paired: settings.cloudShopTokenEncrypted !== null,
    apiUrl: settings.cloudApiUrl,
    shopId: settings.cloudShopId,
    shopName: settings.cloudShopName,
    modules: Array.isArray(settings.cloudEntitlements)
      ? (settings.cloudEntitlements as string[])
      : [],
    syncedAt: settings.cloudSyncedAt?.toISOString() ?? null,
    reachable: null,
  };
}

/**
 * Pair this installation with OficinaOS Cloud. The shop receives a pairing
 * code (from the cloud dashboard or the beta CLI); redeeming it returns a
 * bearer token that authorizes this shop on all cloud endpoints.
 * The token is stored encrypted — same scheme as the AI API key.
 */
export async function pairWithCloud(
  prisma: PrismaClient,
  input: { apiUrl: string; code: string },
  log: FastifyBaseLogger
): Promise<CloudStatus> {
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });

  const res = await cloudFetch(input.apiUrl, "/pairing/redeem", {
    method: "POST",
    body: { code: input.code, label: settings.shopName || "OficinaOS" },
  }).catch(() => null);

  if (!res) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  if (!res.ok) {
    const msg = errorMessage(res.body);
    log.warn({ status: res.status, msg }, "cloud pairing failed");
    throw new AppError(
      res.status === 400 ? "CLOUD_INVALID_CODE" : "CLOUD_PAIRING_FAILED"
    );
  }

  // Cloud contract: { shopToken, shopId, shopName, tokenId }
  const payload = res.body as {
    shopToken?: string;
    shopId?: string;
    shopName?: string;
  };
  if (!payload.shopToken) {
    throw new AppError("CLOUD_PAIRING_FAILED");
  }

  await prisma.shopSettings.update({
    where: { id: "default" },
    data: {
      cloudApiUrl: input.apiUrl,
      cloudShopTokenEncrypted: encryptSecret(payload.shopToken),
      cloudShopId: payload.shopId ?? null,
      cloudShopName: payload.shopName ?? null,
      cloudEntitlements: [],
      cloudSyncedAt: null,
    },
  });

  // Best-effort first sync — pairing already succeeded even if this fails.
  await syncCloudEntitlements(prisma, log).catch(() => null);

  const updated = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  return toStatus(updated);
}

/** Poll the cloud for the current entitlements and cache them locally. */
export async function syncCloudEntitlements(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<CloudStatus> {
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }

  const token = decryptSecret(settings.cloudShopTokenEncrypted);
  const res = await cloudFetch(settings.cloudApiUrl, "/entitlements", {
    token,
  }).catch(() => null);

  if (!res) {
    const status = toStatus(settings);
    status.reachable = false;
    log.warn("cloud unreachable — serving cached entitlements");
    return status;
  }
  if (!res.ok) {
    const status = toStatus(settings);
    status.reachable = false;
    log.warn({ status: res.status }, "cloud entitlements fetch failed");
    if (res.status === 401) {
      throw new AppError("CLOUD_TOKEN_REJECTED");
    }
    return status;
  }

  const payload = res.body as { modules?: string[]; shopName?: string };
  const modules = Array.isArray(payload.modules) ? payload.modules : [];
  const updated = await prisma.shopSettings.update({
    where: { id: "default" },
    data: {
      cloudEntitlements: modules,
      cloudShopName: payload.shopName ?? settings.cloudShopName,
      cloudSyncedAt: new Date(),
    },
  });

  // Pull pending customer diagnostics whenever the shop is entitled — a
  // missed pull never loses data (cloud keeps reports until acked).
  if (modules.includes("diag-intake")) {
    pullCloudIntake(prisma, token, settings.cloudApiUrl, log, notifyCtx).catch(
      (err) => log.warn({ err }, "cloud intake pull failed")
    );
  }

  // Portal público: re-publica páginas cujo job mudou e recolhe respostas
  // de orçamento feitas pelos clientes no link público.
  if (modules.includes("portal")) {
    import("./portal.service.js")
      .then(({ syncPortal }) =>
        syncPortal(prisma, settings.cloudApiUrl ?? "", token, log, notifyCtx)
      )
      .catch((err) => log.warn({ err }, "cloud portal sync failed"));
  }

  // Loja online: publica a montra quando há alterações pendentes e
  // recolhe reservas feitas pelos clientes na página pública.
  if (modules.includes("storefront")) {
    import("./storefront.service.js")
      .then(({ syncStorefront }) =>
        syncStorefront(
          prisma,
          settings.cloudApiUrl ?? "",
          token,
          log,
          notifyCtx
        )
      )
      .catch((err) => log.warn({ err }, "storefront sync failed"));
  }

  // Multi-loja: empurra o snapshot diário agregado (hoje + ontem) para o
  // dashboard do dono na cloud. Só números — nenhum dado de clientes.
  if (modules.includes("multi-shop")) {
    import("./shop-metrics.service.js")
      .then(({ syncShopMetrics }) =>
        syncShopMetrics(prisma, settings.cloudApiUrl ?? "", token, log)
      )
      .catch((err) => log.warn({ err }, "shop-metrics sync failed"));
  }

  // Preços de mercado: empurra o snapshot anónimo de preços quando a loja
  // optou pela partilha e há alterações pendentes.
  if (modules.includes("market-prices")) {
    import("./market-prices.service.js")
      .then(({ syncMarketPrices }) =>
        syncMarketPrices(prisma, settings.cloudApiUrl ?? "", token, log)
      )
      .catch((err) => log.warn({ err }, "market-prices sync failed"));
  }

  // WhatsApp bot: regista o phone_number_id na cloud e processa mensagens
  // inbound enfileiradas pelo webhook da Meta (responder é daqui, com as
  // credenciais Meta que nunca saem da loja).
  if (modules.includes("whatsapp-bot")) {
    import("./whatsapp-bot.service.js")
      .then(({ syncWhatsAppBot }) =>
        syncWhatsAppBot(
          prisma,
          settings.cloudApiUrl ?? "",
          token,
          log,
          notifyCtx
        )
      )
      .catch((err) => log.warn({ err }, "whatsapp-bot sync failed"));
  }

  const status = toStatus(updated);
  status.reachable = true;
  return status;
}

/** Return the cached cloud status; refreshes if the cache is stale. */
export async function getCloudStatus(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  staleMs = 5 * 60 * 1000
): Promise<CloudStatus> {
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  if (!settings.cloudShopTokenEncrypted) {
    return toStatus(settings);
  }
  const stale =
    !settings.cloudSyncedAt ||
    Date.now() - settings.cloudSyncedAt.getTime() > staleMs;
  if (stale) {
    return syncCloudEntitlements(prisma, log).catch((err) => {
      if (err instanceof AppError) {
        throw err;
      }
      return toStatus(settings);
    });
  }
  return toStatus(settings);
}

/** Remove the pairing — Pro modules stop working until re-paired. */
export async function unpairCloud(prisma: PrismaClient): Promise<void> {
  await prisma.shopSettings.update({
    where: { id: "default" },
    data: {
      cloudApiUrl: null,
      cloudShopTokenEncrypted: null,
      cloudShopId: null,
      cloudShopName: null,
      cloudEntitlements: Prisma.DbNull,
      cloudSyncedAt: null,
    },
  });
}

// ── Customer diagnostic intake (Pro module: diag-intake) ────────────

interface CloudIntakePayload {
  aiReport?: string;
  customerEmail?: string;
  customerName: string;
  customerPhone: string;
  device?: {
    brand?: string;
    model?: string;
    os?: string;
    osVersion?: string;
    serial?: string;
  };
  notes?: string;
  results?: Record<string, unknown>;
}

interface CloudIntakeReport {
  createdAt: string;
  id: string;
  payload: CloudIntakePayload;
}

/** Flatten one diagnostic section (e.g. battery) into "a: x, b: y". */
function summarizeResults(results: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(results)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const inner = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(", ");
      lines.push(`${key} — ${inner}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines;
}

function buildDeviceLabel(device: CloudIntakePayload["device"]): string {
  const parts = [device?.brand, device?.model].filter(Boolean);
  return parts.length ? parts.join(" ") : "Dispositivo móvel";
}

function buildProblemText(payload: CloudIntakePayload): string {
  const lines = ["Diagnóstico remoto (oficinaos-diag)"];
  const os = [payload.device?.os, payload.device?.osVersion]
    .filter(Boolean)
    .join(" ");
  if (os) {
    lines.push(`Sistema: ${os}`);
  }
  if (payload.device?.serial) {
    lines.push(`Série: ${payload.device.serial}`);
  }
  if (payload.results) {
    lines.push(...summarizeResults(payload.results));
  }
  if (payload.notes) {
    lines.push(`Notas do cliente: ${payload.notes}`);
  }
  return lines.join("\n");
}

/**
 * Pull customer diagnostics pushed to this shop's public code, create an
 * IntakeRequest per report (they land on the same Pedidos queue as the
 * public pre-check form) and ack them so the cloud stops returning them.
 * externalId dedupes reports already imported before a failed ack.
 */
export async function pullCloudIntake(
  prisma: PrismaClient,
  token: string,
  apiUrl: string,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/shops/intake", { token });
  if (!res.ok) {
    log.warn({ status: res.status }, "cloud intake fetch failed");
    return;
  }
  const reports = (
    (res.body as { reports?: CloudIntakeReport[] }).reports ?? []
  ).filter((r) => r?.payload?.customerName && r.payload.customerPhone);
  if (reports.length === 0) {
    return;
  }

  const ackIds: string[] = [];
  for (const report of reports) {
    const p = report.payload;
    try {
      const request = await createIntakeRequest(prisma, {
        aiReport: typeof p.aiReport === "string" ? p.aiReport : null,
        code: await generateIntakeRequestCode(prisma),
        customerEmail: p.customerEmail || null,
        customerName: p.customerName,
        customerPhone: p.customerPhone,
        deviceLabel: buildDeviceLabel(p.device),
        diagnostic: JSON.parse(JSON.stringify(p)),
        externalId: report.id,
        problem: buildProblemText(p),
        whatsappOptIn: false,
      });
      ackIds.push(report.id);
      notifyIntakeStaff(prisma, request, notifyCtx, log);
    } catch (err) {
      // Unique violation on externalId = already imported before a crash —
      // still ack so the cloud stops redelivering it.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        ackIds.push(report.id);
      } else {
        log.warn({ err, reportId: report.id }, "intake report import failed");
      }
    }
  }

  if (ackIds.length) {
    const ack = await cloudFetch(apiUrl, "/shops/intake/ack", {
      body: { ids: ackIds },
      method: "POST",
      token,
    });
    if (!ack.ok) {
      log.warn({ status: ack.status }, "cloud intake ack failed");
    }
  }
  log.info({ imported: ackIds.length }, "cloud intake pulled");
}

function notifyIntakeStaff(
  prisma: PrismaClient,
  request: { code: string; customerName: string; deviceLabel: string },
  notifyCtx: NotifyContext | undefined,
  log: FastifyBaseLogger
): void {
  if (!notifyCtx) {
    return;
  }
  findManyUsers(
    prisma,
    { isActive: true, role: { in: [Role.OWNER, Role.FRONT_DESK] } },
    { id: true }
  )
    .then((users) =>
      users.length
        ? notify(notifyCtx, {
            context: {
              customerName: request.customerName,
              deviceLabel: request.deviceLabel,
              requestCode: request.code,
            },
            eventName: "pre_check_submitted",
            recipients: { userIds: users.map((u) => u.id) },
          })
        : undefined
    )
    .catch((err) => log.warn({ err }, "intake notification failed"));
}
