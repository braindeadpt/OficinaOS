import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";

const MAX_SEQ = 999_999;

/**
 * Allocates the next intake-request sequence for the year, same atomic
 * insert-or-increment pattern as job codes (see job-code.ts).
 */
export async function generateIntakeRequestCode(
  prisma: PrismaClient
): Promise<string> {
  const year = new Date().getFullYear();

  const rows = await prisma.$queryRaw<Array<{ lastSeq: number | string }>>`
    INSERT INTO "intake_request_counters" ("year", "lastSeq")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "lastSeq" = "intake_request_counters"."lastSeq" + 1
    WHERE "intake_request_counters"."lastSeq" < ${MAX_SEQ}
    RETURNING "lastSeq"
  `;

  const allocated = rows[0]?.lastSeq;
  if (allocated === undefined) {
    throw new AppError("JOB_CODE_OVERFLOW");
  }

  const seq = String(
    typeof allocated === "string" ? Number.parseInt(allocated, 10) : allocated
  ).padStart(6, "0");
  return `PRE-${year}-${seq}`;
}
