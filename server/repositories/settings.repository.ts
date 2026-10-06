import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

interface AiSettingsUpsertInput {
  create: Prisma.AiSettingsCreateInput;
  update: Record<string, unknown>;
  where: Prisma.AiSettingsWhereUniqueInput;
}

interface ShopSettingsUpsertInput {
  create: Prisma.ShopSettingsCreateInput;
  update: Record<string, unknown>;
  where: Prisma.ShopSettingsWhereUniqueInput;
}

export async function findAiSettingsUnique(prisma: DbClient) {
  return await prisma.aiSettings.findUnique({ where: { id: "default" } });
}

export async function upsertAiSettings(
  prisma: DbClient,
  input: AiSettingsUpsertInput
) {
  return await prisma.aiSettings.upsert(input);
}

export async function findShopSettingsUnique(prisma: DbClient) {
  return await prisma.shopSettings.findUnique({ where: { id: "default" } });
}

const SHOP_SETTINGS_ID = "default";

/**
 * The singleton shop settings row. On a fresh install (before the shop is
 * set up) the row does not exist yet, so it is created with the schema
 * defaults instead of throwing — callers can rely on getting a row.
 * The read-first path keeps the common case a single SELECT; the upsert
 * makes concurrent first reads race-safe.
 */
export async function getOrCreateShopSettings(prisma: DbClient) {
  const existing = await prisma.shopSettings.findUnique({
    where: { id: SHOP_SETTINGS_ID },
  });
  if (existing) {
    return existing;
  }
  return await prisma.shopSettings.upsert({
    where: { id: SHOP_SETTINGS_ID },
    create: { id: SHOP_SETTINGS_ID },
    update: {},
  });
}

export async function upsertShopSettings(
  prisma: DbClient,
  input: ShopSettingsUpsertInput
) {
  return await prisma.shopSettings.upsert(input);
}

export async function findManyNotificationTemplates(prisma: DbClient) {
  return await prisma.notificationTemplate.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function updateNotificationTemplate(
  prisma: DbClient,
  id: string,
  data: Prisma.NotificationTemplateUpdateInput
) {
  return await prisma.notificationTemplate.update({ where: { id }, data });
}
