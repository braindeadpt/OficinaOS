import catalog from "@shared/device-catalog.json";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";

interface CatalogModel {
  category: string;
  model: string;
}

interface CatalogBrand {
  models: CatalogModel[];
  name: string;
}

const BRANDS = (catalog as { brands: CatalogBrand[] }).brands;
export const DEVICE_CATALOG_VERSION = (catalog as { version: number }).version;

export interface CatalogSyncResult {
  brands: number;
  devicesCreated: number;
  devicesUpdated: number;
  skipped: boolean;
}

/**
 * Upserts the bundled device catalog into brands/devices, but only when
 * the shop's stamped version is behind — runs once per catalog release.
 * Never deletes: jobs reference devices with onDelete: Restrict, and a
 * shop may rely on models the bundled catalog doesn't list.
 */
export async function syncDeviceCatalogIfStale(
  prisma: DbClient
): Promise<CatalogSyncResult> {
  const settings = await getOrCreateShopSettings(prisma);
  if (settings.deviceCatalogVersion >= DEVICE_CATALOG_VERSION) {
    return { brands: 0, devicesCreated: 0, devicesUpdated: 0, skipped: true };
  }

  let devicesCreated = 0;
  let devicesUpdated = 0;

  // Brand names match case-insensitively: older seeds created "Vivo" while
  // the catalog says "vivo" — an exact-name upsert would split the catalog
  // across two brands. Existing rows keep their id, name and relations.
  // One transaction: a crash mid-sync must not leave a partial catalog with
  // the version already bumped (the bump is the "done" marker).
  await prisma.$transaction(async (tx) => {
    const existingBrands = await tx.brand.findMany({
      select: { id: true, name: true },
    });
    const brandsByLower = new Map(
      existingBrands.map((b) => [b.name.toLowerCase(), b])
    );

    for (const entry of BRANDS) {
      let brand = brandsByLower.get(entry.name.toLowerCase());
      if (!brand) {
        brand = await tx.brand.create({ data: { name: entry.name } });
        brandsByLower.set(entry.name.toLowerCase(), brand);
      }

      const existing = await tx.device.findMany({
        select: { category: true, id: true, model: true },
        where: { brandId: brand.id },
      });
      const byModel = new Map(existing.map((d) => [d.model, d]));

      const toCreate: { brandId: string; category: string; model: string }[] =
        [];
      for (const m of entry.models) {
        const ex = byModel.get(m.model);
        if (!ex) {
          toCreate.push({
            brandId: brand.id,
            category: m.category,
            model: m.model,
          });
        } else if (ex.category !== m.category) {
          await tx.device.update({
            data: { category: m.category },
            where: { id: ex.id },
          });
          devicesUpdated++;
        }
      }
      if (toCreate.length > 0) {
        const res = await tx.device.createMany({ data: toCreate });
        devicesCreated += res.count;
      }
    }

    await tx.shopSettings.update({
      data: { deviceCatalogVersion: DEVICE_CATALOG_VERSION },
      where: { id: settings.id },
    });
  });

  const result = {
    brands: BRANDS.length,
    devicesCreated,
    devicesUpdated,
    skipped: false,
  };
  logger.info(
    { ...result, version: DEVICE_CATALOG_VERSION },
    "device catalog synced"
  );
  return result;
}
