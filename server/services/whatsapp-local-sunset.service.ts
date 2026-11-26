import { WHATSAPP_LOCAL_DEPRECATION_MS } from "@shared/constants/whatsapp-migration.js";
import type { DbClient } from "../repositories/types.js";

export const WHATSAPP_MIGRATION_EVENTS_VISIBLE = 20;

export type WhatsAppMigrationEventKind =
  | "LOCAL_FALLBACK"
  | "LOCAL_TOKEN_PURGED";

export async function recordWhatsAppMigrationEvent(
  prisma: DbClient,
  type: WhatsAppMigrationEventKind,
  reason: string
): Promise<void> {
  await prisma.whatsAppMigrationEvent.create({
    data: { reason, type },
  });
}

export async function listWhatsAppMigrationEvents(
  prisma: DbClient,
  limit = WHATSAPP_MIGRATION_EVENTS_VISIBLE
) {
  return await prisma.whatsAppMigrationEvent.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, id: true, reason: true, type: true },
    take: limit,
  });
}

/**
 * Remove o token Meta local depois do fim da janela de transição. O apagamento
 * é idempotente e usa o padrão updateMany-condicional da casa: só escreve o
 * evento de auditoria na mesma transação quando esta instância ganhou a corrida
 * e removeu exatamente o snapshot do token lido antes.
 */
export async function purgeExpiredWhatsAppLocalToken(
  prisma: DbClient,
  now: Date = new Date()
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - WHATSAPP_LOCAL_DEPRECATION_MS);
  const row = await prisma.shopSettings.findUnique({
    select: {
      whatsappApiTokenEncrypted: true,
      whatsappLocalDeprecationStartedAt: true,
    },
    where: { id: "default" },
  });
  const tokenSnapshot = row?.whatsappApiTokenEncrypted;
  const startedAt = row?.whatsappLocalDeprecationStartedAt;
  if (!(tokenSnapshot && startedAt) || startedAt > cutoff) {
    return false;
  }

  return await prisma.$transaction(async (tx) => {
    const purged = await tx.shopSettings.updateMany({
      data: { whatsappApiTokenEncrypted: null },
      where: {
        id: "default",
        whatsappApiTokenEncrypted: tokenSnapshot,
        whatsappLocalDeprecationStartedAt: { lte: cutoff },
      },
    });
    if (purged.count === 0) {
      return false;
    }
    await tx.whatsAppMigrationEvent.create({
      data: {
        reason: "transition_deadline_reached",
        type: "LOCAL_TOKEN_PURGED",
      },
    });
    return true;
  });
}
