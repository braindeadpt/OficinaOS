import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import type { DbClient } from "../repositories/types.js";
import { cloudFetch } from "./cloud.service.js";

const NON_ALNUM = /[^a-z0-9]+/g;
const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Preços de mercado agregados (módulo Pro "market-prices"): a loja opt-in
 * partilha os preços do seu catálogo de forma anónima; a cloud devolve
 * médias/mediana por artigo só quando >=3 lojas contribuem — o preço de
 * uma loja individual nunca é exposto.
 */

/** Same canonical key as the cloud — used to match benchmarks to own items. */
export function normalizePriceKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_ALNUM, " ")
    .trim()
    .slice(0, 200);
}

/** Marca o snapshot de preços como "por sincronizar" — o próximo poll empurra-o. */
export async function markPricesDirty(prisma: DbClient): Promise<void> {
  await prisma.shopSettings.update({
    where: { id: "default" },
    data: { pricesDirty: true },
  });
}

/**
 * Empurra o catálogo de preços quando sharePrices && pricesDirty.
 * Substituto completo no lado da cloud (delete+insert atómico).
 */
export async function pushMarketPrices(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger
): Promise<void> {
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
    select: { sharePrices: true, pricesDirty: true },
  });
  if (!(settings.sharePrices && settings.pricesDirty)) {
    return;
  }

  const [repairs, parts] = await Promise.all([
    prisma.repairCatalog.findMany({
      where: { isActive: true },
      select: { category: true, defaultPrice: true, name: true },
      take: 1000,
    }),
    prisma.partsCatalog.findMany({
      where: { isActive: true },
      select: { category: true, defaultPrice: true, name: true },
      take: 1000,
    }),
  ]);

  const res = await cloudFetch(apiUrl, "/prices/contribute", {
    body: {
      items: [
        ...repairs.map((r) => ({
          category: r.category,
          kind: "repair",
          name: r.name,
          priceCents: Math.round(Number(r.defaultPrice) * 100),
        })),
        ...parts.map((p) => ({
          category: p.category,
          kind: "part",
          name: p.name,
          priceCents: Math.round(Number(p.defaultPrice) * 100),
        })),
      ],
    },
    method: "POST",
    token,
  }).catch(() => null);

  if (!res) {
    log.warn("market-prices push failed — cloud unreachable");
    return;
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "market-prices push rejected");
    return;
  }

  await prisma.shopSettings.update({
    where: { id: "default" },
    data: { pricesDirty: false },
  });
}

/** Opt-out: removes every contribution this shop ever sent. Best-effort. */
export async function withdrawMarketPrices(
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/prices/contribute", {
    method: "DELETE",
    token,
  }).catch(() => null);
  if (!res?.ok) {
    log.warn({ status: res?.status }, "market-prices withdraw failed");
  }
}

/** Chamado pelo poller quando a loja tem o módulo "market-prices". */
export async function syncMarketPrices(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger
): Promise<void> {
  await pushMarketPrices(prisma, apiUrl, token, log);
}
