import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import {
  normalizePriceKey,
  pushMarketPrices,
  withdrawMarketPrices,
} from "../services/market-prices.service.js";

const MODULE = "market-prices";

interface CloudAuth {
  apiUrl: string;
  token: string;
}

interface StatRow {
  avgCents: number;
  category: string | null;
  key: string;
  kind: string;
  // Null when fewer than 5 shops report the item — the cloud withholds
  // min/max so a single shop's price can't be singled out.
  maxCents: number | null;
  medianCents: number;
  minCents: number | null;
  name: string;
  shopCount: number;
  updatedAt: string;
}

/**
 * Preços de mercado agregados (módulo Pro "market-prices"): benchmarks
 * anónimos calculados na cloud a partir dos catálogos das lojas Pro que
 * optaram por partilhar. A app é um proxy autenticado — o token nunca
 * chega ao browser e a cloud revalida o entitlement em cada pedido.
 */
async function requireMarketPrices(
  prisma: PrismaClient
): Promise<{ auth: CloudAuth; settings: { sharePrices: boolean } }> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[])
    : [];
  if (!modules.includes(MODULE)) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  return {
    auth: {
      apiUrl: settings.cloudApiUrl,
      token: decryptSecret(settings.cloudShopTokenEncrypted),
    },
    settings: { sharePrices: settings.sharePrices },
  };
}

/** Own catalog prices keyed `${kind}:${normalized name}` — first wins. */
async function ownPriceMap(prisma: PrismaClient) {
  const [repairs, parts] = await Promise.all([
    prisma.repairCatalog.findMany({
      where: { isActive: true },
      select: { defaultPrice: true, name: true },
    }),
    prisma.partsCatalog.findMany({
      where: { isActive: true },
      select: { defaultPrice: true, name: true },
    }),
  ]);
  const map = new Map<string, number>();
  for (const r of repairs) {
    const k = `repair:${normalizePriceKey(r.name)}`;
    if (!map.has(k)) {
      map.set(k, Math.round(Number(r.defaultPrice) * 100));
    }
  }
  for (const p of parts) {
    const k = `part:${normalizePriceKey(p.name)}`;
    if (!map.has(k)) {
      map.set(k, Math.round(Number(p.defaultPrice) * 100));
    }
  }
  return map;
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const marketPricesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [requirePermission({ repairs: ["viewCatalog"] })],
      schema: {
        summary: "Aggregated market price benchmarks",
        tags: ["market-prices"],
      },
    },
    async (_req, reply) => {
      const { auth, settings } = await requireMarketPrices(app.prisma);
      const res = await cloudFetch(auth.apiUrl, "/prices/stats", {
        token: auth.token,
      }).catch(() => null);
      if (!res?.ok) {
        const code = (res?.body as { error?: { code?: string } } | null)?.error
          ?.code;
        if (code === "MODULE_NOT_ENTITLED" || res?.status === 402) {
          throw new AppError("CLOUD_MODULE_REQUIRED");
        }
        throw new AppError("CLOUD_UNREACHABLE");
      }
      const stats =
        (res.body as { stats?: StatRow[] }).stats ?? ([] as StatRow[]);
      const own = await ownPriceMap(app.prisma);
      return reply.send({
        sharing: settings.sharePrices,
        stats: stats.map((s) => ({
          ...s,
          ownPriceCents: own.get(`${s.kind}:${s.key}`) ?? null,
        })),
      });
    }
  );

  app.put(
    "/",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        body: {
          additionalProperties: false,
          properties: { sharePrices: { type: "boolean" } },
          required: ["sharePrices"],
          type: "object",
        },
        summary: "Toggle anonymous price sharing",
        tags: ["market-prices"],
      },
    },
    async (req, reply) => {
      const { sharePrices } = req.body as { sharePrices: boolean };
      const { auth } = await requireMarketPrices(app.prisma);
      await app.prisma.shopSettings.update({
        where: { id: "default" },
        data: { pricesDirty: true, sharePrices },
      });
      // Best-effort immediate sync — the poll retries if the cloud is down.
      if (sharePrices) {
        await pushMarketPrices(app.prisma, auth.apiUrl, auth.token, req.log);
      } else {
        await withdrawMarketPrices(auth.apiUrl, auth.token, req.log);
      }
      return reply.send({ sharePrices });
    }
  );
};
