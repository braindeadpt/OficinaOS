import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { DbClient } from "../repositories/types.js";

const MAX_SEQ = 999_999;

/**
 * Allocates the next sale sequence for the year.
 *
 * The increment is conditional on the counter still being below the ceiling,
 * so an exhausted year refuses new codes without ever committing an
 * out-of-range value — the previous unconditional increment committed
 * 1_000_000 and then threw, leaving the counter permanently stuck above the
 * limit until someone fixed the row by hand.
 *
 * Safe under concurrency: the insert-or-increment is a single atomic
 * statement, and two callers can never be handed the same sequence.
 */
export async function generateSaleCode(
  prisma: DbClient | PrismaClient
): Promise<string> {
  const year = new Date().getFullYear();

  const rows = await prisma.$queryRaw<Array<{ lastSeq: number | string }>>`
    INSERT INTO "sale_counters" ("year", "lastSeq")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "lastSeq" = "sale_counters"."lastSeq" + 1
    WHERE "sale_counters"."lastSeq" < ${MAX_SEQ}
    RETURNING "lastSeq"
  `;

  const allocated = rows[0]?.lastSeq;
  if (allocated === undefined) {
    throw new AppError("JOB_CODE_OVERFLOW");
  }

  const seq = String(
    typeof allocated === "string" ? Number.parseInt(allocated, 10) : allocated
  ).padStart(6, "0");
  return `SALE-${year}-${seq}`;
}
