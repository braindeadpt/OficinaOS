import type { AuditAction } from "@generated/client";
import { create, deleteMany } from "../repositories/audit.repository.js";
import type { DbClient } from "../repositories/types.js";
import { logger } from "../utils/logger.js";

// RGPD/auditoria: entradas com mais de 24 meses deixam de ter valor legal
// e crescem sem limite — são apagadas por um sweep periódico.
const AUDIT_RETENTION_MONTHS = 24;

export type { DbClient } from "../repositories/types.js";

interface AuditInput {
  action: AuditAction;
  createdAt?: Date;
  fromValue?: string;
  jobId: string | null;
  metadata?: Record<string, unknown>;
  note?: string;
  toValue?: string;
  userId: string;
}

export async function createAuditLog(
  prisma: DbClient,
  input: AuditInput
): Promise<void> {
  await create(prisma, input);
}

export async function cleanupOldAuditLogs(prisma: DbClient) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - AUDIT_RETENTION_MONTHS);

  const result = await deleteMany(prisma, { createdAt: { lt: cutoff } });

  if (result.count > 0) {
    logger.info(
      `[cleanup] Deleted ${result.count} audit log entries older than ${AUDIT_RETENTION_MONTHS} months`
    );
  }
}
