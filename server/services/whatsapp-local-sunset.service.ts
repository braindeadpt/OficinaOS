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
 * Remove o token Meta local depois do fim da janela de transição. Um token
 * introduzido DEPOIS do prazo não é apagado enquanto estiver pendente de
 * upload consentido para a Cloud — esse segredo nunca pode enviar diretamente,
 * mas sem ele a loja teria de o reintroduzir a cada falha transitória. Quando
 * a Cloud confirma essas credenciais, ou quando o token já existia antes do
 * fim do prazo, o purge continua a aplicar-se. O apagamento é idempotente e
 * usa o padrão updateMany-condicional da casa: só escreve o evento de auditoria
 * na mesma transação quando esta instância ganhou a corrida e removeu exatamente
 * o snapshot do token lido antes.
 */
export async function purgeExpiredWhatsAppLocalToken(
  prisma: DbClient,
  now: Date = new Date()
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - WHATSAPP_LOCAL_DEPRECATION_MS);
  const row = await prisma.shopSettings.findUnique({
    select: {
      whatsappApiTokenEncrypted: true,
      whatsappApiTokenWrittenAt: true,
      whatsappCloudConsentAt: true,
      whatsappCredentialsAtCloud: true,
      whatsappLocalDeprecationStartedAt: true,
    },
    where: { id: "default" },
  });
  const tokenSnapshot = row?.whatsappApiTokenEncrypted;
  const startedAt = row?.whatsappLocalDeprecationStartedAt;
  if (!(tokenSnapshot && startedAt) || startedAt > cutoff) {
    return false;
  }
  const transitionDeadline = new Date(
    startedAt.getTime() + WHATSAPP_LOCAL_DEPRECATION_MS
  );
  const legacyToken =
    !row.whatsappApiTokenWrittenAt ||
    row.whatsappApiTokenWrittenAt < transitionDeadline;
  const postDeadlineUploadPending =
    !(legacyToken || row.whatsappCredentialsAtCloud) &&
    row.whatsappCloudConsentAt !== null;
  if (postDeadlineUploadPending) {
    return false;
  }

  return await prisma.$transaction(async (tx) => {
    const purged = await tx.shopSettings.updateMany({
      data: {
        whatsappApiTokenEncrypted: null,
        whatsappApiTokenWrittenAt: null,
      },
      where: {
        OR: [
          { whatsappApiTokenWrittenAt: null },
          { whatsappApiTokenWrittenAt: { lt: transitionDeadline } },
          { whatsappCloudConsentAt: null },
          { whatsappCredentialsAtCloud: true },
        ],
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
