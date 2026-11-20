import type { Prisma, PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
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

const CATALOG_PAGE = 500;

interface CatalogRow {
  category: string | null;
  defaultPrice: Prisma.Decimal;
  id: string;
  name: string;
}

interface CatalogTable {
  findMany(args: {
    cursor?: { id: string };
    orderBy: { id: "asc" };
    select: { category: true; defaultPrice: true; id: true; name: true };
    skip?: number;
    take: number;
    where: { isActive: boolean };
  }): Promise<CatalogRow[]>;
}

/** Active catalog rows in bounded keyset pages — a large catalog never lands in one query. */
async function readCatalogPages(table: CatalogTable): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  let cursor: { id: string } | undefined;
  for (;;) {
    const page = await table.findMany({
      cursor,
      orderBy: { id: "asc" },
      select: { category: true, defaultPrice: true, id: true, name: true },
      skip: cursor ? 1 : 0,
      take: CATALOG_PAGE,
      where: { isActive: true },
    });
    rows.push(...page);
    if (page.length < CATALOG_PAGE) {
      return rows;
    }
    const last = page.at(-1);
    if (!last) {
      return rows;
    }
    cursor = { id: last.id };
  }
}

export interface PriceItem {
  category: string | null;
  kind: "repair" | "part";
  name: string;
  priceCents: number;
}

/** Catálogo ativo (reparações + peças) normalizado para preços de mercado. */
export async function listActivePriceItems(
  prisma: PrismaClient
): Promise<PriceItem[]> {
  const [repairs, parts] = await Promise.all([
    readCatalogPages(prisma.repairCatalog),
    readCatalogPages(prisma.partsCatalog),
  ]);
  return [
    ...repairs.map((r) => ({
      category: r.category,
      kind: "repair" as const,
      name: r.name,
      priceCents: Math.round(Number(r.defaultPrice) * 100),
    })),
    ...parts.map((p) => ({
      category: p.category,
      kind: "part" as const,
      name: p.name,
      priceCents: Math.round(Number(p.defaultPrice) * 100),
    })),
  ];
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
  const settings = await getOrCreateShopSettings(prisma);
  if (!(settings.sharePrices && settings.pricesDirty)) {
    return;
  }

  const items = await listActivePriceItems(prisma);

  const res = await cloudFetch(apiUrl, "/prices/contribute", {
    body: { items },
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
