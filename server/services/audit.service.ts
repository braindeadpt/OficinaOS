import type { AuditAction } from "@generated/client";
import { create } from "../repositories/audit.repository.js";
import type { DbClient } from "../repositories/types.js";

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
