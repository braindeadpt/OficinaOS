import { Prisma, type PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";

const FETCH_TIMEOUT_MS = 10_000;

interface CloudErrorBody {
  error?: { code?: string; message?: string };
}

const TRAILING_SLASHES = /\/+$/;

function errorMessage(body: unknown): string | undefined {
  const err = (body as CloudErrorBody | null)?.error;
  return err?.message ?? err?.code;
}

async function cloudFetch(
  apiUrl: string,
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
  log: FastifyBaseLogger
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
  const updated = await prisma.shopSettings.update({
    where: { id: "default" },
    data: {
      cloudEntitlements: Array.isArray(payload.modules) ? payload.modules : [],
      cloudShopName: payload.shopName ?? settings.cloudShopName,
      cloudSyncedAt: new Date(),
    },
  });
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
