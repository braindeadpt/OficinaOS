import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { DbClient } from "../repositories/types.js";

const MAX_SEQ = 999_999;

export async function generateSaleCode(
  prisma: DbClient | PrismaClient
): Promise<string> {
  const year = new Date().getFullYear();

  const counter = await prisma.saleCounter.upsert({
    where: { year },
    update: { lastSeq: { increment: 1 } },
    create: { year, lastSeq: 1 },
  });

  if (counter.lastSeq > MAX_SEQ) {
    throw new AppError("JOB_CODE_OVERFLOW");
  }

  const seq = counter.lastSeq.toString().padStart(6, "0");
  return `SALE-${year}-${seq}`;
}
