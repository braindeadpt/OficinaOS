import type { PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import type { PartCategoryType, RepairCategoryType } from "@shared/constants";
import type { JobStatusType } from "@shared/constants/job-statuses";
import type {
  ImportRowError,
  ImportSummary,
  JobImportRow,
  PartImportRow,
  RepairImportRow,
} from "@shared/schemas/data-io.schema";
import {
  jobImportRowSchema,
  partImportRowSchema,
  repairImportRowSchema,
} from "@shared/schemas/data-io.schema";
import type { z } from "zod";
import { resolveValidationMessage } from "../utils/resolve-validation-messages.js";
import { createImportedJob } from "./job.service.js";

const CSV_NEEDS_QUOTES = /[",\n\r;]/;
const CSV_QUOTE = /"/g;
// Cells that open with these run as formulas/commands in Excel and Sheets —
// third-party text (e.g. the public pre-check form) can weaponise an export.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Page size for streamed exports — no 50k-row findMany held in memory. */
const EXPORT_PAGE_SIZE = 1000;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let s = String(value);
  if (CSV_FORMULA_PREFIX.test(s)) {
    s = `'${s}`;
  }
  return CSV_NEEDS_QUOTES.test(s) ? `"${s.replace(CSV_QUOTE, '""')}"` : s;
}

export interface ExportResult {
  csv: string;
  rows: number;
}

/** First DELIVERED transition per job, from the audit trail. */
async function deliveredAtByJob(
  prisma: PrismaClient,
  jobIds: string[]
): Promise<Map<string, Date>> {
  const rows = await prisma.auditLog.findMany({
    where: {
      jobId: { in: jobIds },
      action: AuditAction.STATUS_CHANGED,
      toValue: "DELIVERED",
    },
    orderBy: { createdAt: "asc" },
    select: { jobId: true, createdAt: true },
  });
  const map = new Map<string, Date>();
  for (const r of rows) {
    if (r.jobId && !map.has(r.jobId)) {
      map.set(r.jobId, r.createdAt);
    }
  }
  return map;
}

export async function exportJobsCsv(
  prisma: PrismaClient
): Promise<ExportResult> {
  const lines = [
    [
      "jobCode",
      "createdAt",
      "status",
      "customerName",
      "customerPhone",
      "customerEmail",
      "deviceBrand",
      "deviceModel",
      "problem",
      "estimatedCost",
      "deliveredAt",
    ]
      .map(csvEscape)
      .join(";"),
  ];
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.job.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        customer: { select: { name: true, phone: true, email: true } },
        device: { include: { brand: { select: { name: true } } } },
      },
      take: EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) {
      break;
    }
    const delivered = await deliveredAtByJob(
      prisma,
      page.map((j) => j.id)
    );
    for (const j of page) {
      lines.push(
        [
          j.jobCode,
          j.createdAt.toISOString(),
          j.status,
          j.customer.name,
          j.customer.phone,
          j.customer.email,
          j.device.brand.name,
          j.device.model,
          j.reportedProblem,
          j.estimatedCost?.toString(),
          delivered.get(j.id)?.toISOString(),
        ]
          .map(csvEscape)
          .join(";")
      );
      count += 1;
    }
    if (page.length < EXPORT_PAGE_SIZE) {
      break;
    }
    cursor = page.at(-1)?.id;
  }
  return { csv: `﻿${lines.join("\r\n")}`, rows: count };
}

export async function exportPartsCsv(
  prisma: PrismaClient
): Promise<ExportResult> {
  const lines = [
    ["name", "category", "price", "stock", "reorderLevel", "supplier", "active"]
      .map(csvEscape)
      .join(";"),
  ];
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.partsCatalog.findMany({
      orderBy: { id: "asc" },
      take: EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) {
      break;
    }
    for (const p of page) {
      lines.push(
        [
          p.name,
          p.category,
          p.defaultPrice.toString(),
          p.stockQuantity,
          p.reorderLevel,
          p.supplier,
          p.isActive ? 1 : 0,
        ]
          .map(csvEscape)
          .join(";")
      );
      count += 1;
    }
    if (page.length < EXPORT_PAGE_SIZE) {
      break;
    }
    cursor = page.at(-1)?.id;
  }
  return { csv: `﻿${lines.join("\r\n")}`, rows: count };
}

export async function exportRepairsCsv(
  prisma: PrismaClient
): Promise<ExportResult> {
  const lines = [
    ["name", "category", "price", "warrantyDays", "active"]
      .map(csvEscape)
      .join(";"),
  ];
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.repairCatalog.findMany({
      orderBy: { id: "asc" },
      take: EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) {
      break;
    }
    for (const r of page) {
      lines.push(
        [
          r.name,
          r.category,
          r.defaultPrice.toString(),
          r.warrantyDays,
          r.isActive ? 1 : 0,
        ]
          .map(csvEscape)
          .join(";")
      );
      count += 1;
    }
    if (page.length < EXPORT_PAGE_SIZE) {
      break;
    }
    cursor = page.at(-1)?.id;
  }
  return { csv: `﻿${lines.join("\r\n")}`, rows: count };
}

// ---------------------------------------------------------------------------
// Row-level import helpers
// ---------------------------------------------------------------------------

function pushIssues(
  error: z.ZodError,
  row: number,
  errors: ImportRowError[],
  locale: string
) {
  for (const issue of error.issues) {
    errors.push({
      row,
      field: String(issue.path[0] ?? ""),
      message: resolveValidationMessage(issue.message, locale),
    });
  }
}

function pushRowError(
  row: number,
  field: string,
  key: string,
  errors: ImportRowError[],
  locale: string
) {
  errors.push({ row, field, message: resolveValidationMessage(key, locale) });
}

function emptySummary(): ImportSummary {
  return { created: 0, updated: 0, skipped: 0, errors: [] };
}

// ---------------------------------------------------------------------------
// Parts / repairs
// ---------------------------------------------------------------------------

function partPatch(
  row: PartImportRow,
  supplierId: string | null
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (row.category !== undefined) {
    patch.category = row.category as PartCategoryType;
  }
  if (row.price !== undefined) {
    patch.defaultPrice = row.price;
  }
  if (row.reorderLevel !== undefined) {
    patch.reorderLevel = row.reorderLevel;
  }
  if (row.supplier !== undefined) {
    patch.supplier = row.supplier;
    patch.supplierId = supplierId;
  }
  if (row.active !== undefined) {
    patch.isActive = row.active;
  }
  return patch;
}

/**
 * A supplier column links the part to a Supplier record only when the name
 * hits exactly one row (case-insensitive, trimmed) — an ambiguous or
 * unknown name keeps the free-text value and leaves supplierId null rather
 * than guessing. Cached per import so 500 rows with the same supplier cost
 * one query.
 */
function makeSupplierResolver(prisma: PrismaClient) {
  const cache = new Map<string, string | null>();
  return async (name: string | undefined): Promise<string | null> => {
    if (name === undefined) {
      return null;
    }
    const key = name.trim().toLowerCase();
    if (!key) {
      return null;
    }
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const matches = await prisma.supplier.findMany({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    const id = matches.length === 1 ? (matches[0]?.id ?? null) : null;
    cache.set(key, id);
    return id;
  };
}

/**
 * Per-row transaction: catalog field patch +, when the stock column is
 * present and differs from the LOCKED balance, an ADJUSTMENT StockMovement
 * with the signed delta — the ledger keeps the who/when/why instead of a
 * silent overwrite. The balance is read with FOR UPDATE inside the
 * transaction so a sale that lands between the name lookup and this write
 * can't produce a fake delta or a ledger balance that never existed.
 */
async function updatePartFromRow(
  prisma: PrismaClient,
  existing: { id: string; stockQuantity: number },
  row: PartImportRow,
  userId: string,
  supplierId: string | null
) {
  await prisma.$transaction(async (tx) => {
    const patch = partPatch(row, supplierId);
    if (Object.keys(patch).length > 0) {
      await tx.partsCatalog.update({ where: { id: existing.id }, data: patch });
    }
    if (row.stock === undefined) {
      return;
    }
    const locked = await tx.$queryRaw<
      Array<{ stockQuantity: number | string }>
    >`
      SELECT "stockQuantity" FROM "parts_catalog"
      WHERE "id" = ${existing.id}
      FOR UPDATE
    `;
    const current = Number(locked[0]?.stockQuantity);
    if (!Number.isFinite(current)) {
      throw new Error("part_vanished_between_lookup_and_write");
    }
    const delta = row.stock - current;
    if (delta === 0) {
      return;
    }
    const updated = await tx.$queryRaw<
      Array<{ stockQuantity: number | string }>
    >`
      UPDATE "parts_catalog"
      SET "stockQuantity" = ${row.stock}
      WHERE "id" = ${existing.id}
      RETURNING "stockQuantity"
    `;
    const balanceAfter = Number(updated[0]?.stockQuantity);
    if (updated.length === 0 || !Number.isFinite(balanceAfter)) {
      throw new Error("part_vanished_between_lookup_and_write");
    }
    await tx.stockMovement.create({
      data: {
        partId: existing.id,
        type: "ADJUSTMENT",
        quantity: delta,
        balanceAfter,
        note: "import",
        createdById: userId,
      },
    });
  });
}

export async function importParts(
  prisma: PrismaClient,
  rows: unknown[],
  userId: string,
  locale: string
): Promise<ImportSummary> {
  const summary = emptySummary();
  const resolveSupplierId = makeSupplierResolver(prisma);
  for (const [index, raw] of rows.entries()) {
    const rowNo = index + 2;
    const parsed = partImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      pushIssues(parsed.error, rowNo, summary.errors, locale);
      continue;
    }
    const row = parsed.data;
    try {
      // Name matches are case-insensitive; more than one hit means the
      // catalogue is ambiguous — a blind update would write to a random one.
      const matches = await prisma.partsCatalog.findMany({
        where: { name: { equals: row.name.trim(), mode: "insensitive" } },
        select: { id: true, stockQuantity: true },
      });
      if (matches.length > 1) {
        pushRowError(
          rowNo,
          "name",
          "validations.import_duplicate",
          summary.errors,
          locale
        );
        continue;
      }
      const existing = matches[0];
      const supplierId = await resolveSupplierId(row.supplier);
      if (existing) {
        await updatePartFromRow(prisma, existing, row, userId, supplierId);
        summary.updated += 1;
      } else {
        // A brand-new part that arrives with stock still needs the ledger
        // entry — the opening balance is an ADJUSTMENT like any other.
        await prisma.$transaction(async (tx) => {
          const part = await tx.partsCatalog.create({
            data: {
              name: row.name.trim(),
              category: (row.category ?? "OTHER") as PartCategoryType,
              defaultPrice: row.price ?? 0,
              stockQuantity: row.stock ?? 0,
              reorderLevel: row.reorderLevel ?? 0,
              supplier: row.supplier ?? null,
              supplierId,
              isActive: row.active ?? true,
            },
          });
          const stock = row.stock ?? 0;
          if (stock > 0) {
            await tx.stockMovement.create({
              data: {
                partId: part.id,
                type: "ADJUSTMENT",
                quantity: stock,
                balanceAfter: stock,
                note: "import",
                createdById: userId,
              },
            });
          }
        });
        summary.created += 1;
      }
    } catch {
      pushRowError(
        rowNo,
        "",
        "validations.import_error",
        summary.errors,
        locale
      );
    }
  }
  return summary;
}

function repairPatch(row: RepairImportRow): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (row.category !== undefined) {
    patch.category = row.category as RepairCategoryType;
  }
  if (row.price !== undefined) {
    patch.defaultPrice = row.price;
  }
  if (row.warrantyDays !== undefined) {
    patch.warrantyDays = row.warrantyDays;
  }
  if (row.active !== undefined) {
    patch.isActive = row.active;
  }
  return patch;
}

export async function importRepairs(
  prisma: PrismaClient,
  rows: unknown[],
  locale: string
): Promise<ImportSummary> {
  const summary = emptySummary();
  for (const [index, raw] of rows.entries()) {
    const rowNo = index + 2;
    const parsed = repairImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      pushIssues(parsed.error, rowNo, summary.errors, locale);
      continue;
    }
    const row = parsed.data;
    try {
      const matches = await prisma.repairCatalog.findMany({
        where: { name: { equals: row.name.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (matches.length > 1) {
        pushRowError(
          rowNo,
          "name",
          "validations.import_duplicate",
          summary.errors,
          locale
        );
        continue;
      }
      const existing = matches[0];
      const patch = repairPatch(row);
      if (existing) {
        if (Object.keys(patch).length > 0) {
          await prisma.repairCatalog.update({
            where: { id: existing.id },
            data: patch,
          });
        }
        summary.updated += 1;
      } else {
        await prisma.repairCatalog.create({
          data: {
            name: row.name.trim(),
            category: (row.category ?? "OTHER") as RepairCategoryType,
            defaultPrice: row.price ?? 0,
            warrantyDays: row.warrantyDays ?? 0,
            isActive: row.active ?? true,
          },
        });
        summary.created += 1;
      }
    } catch {
      pushRowError(
        rowNo,
        "",
        "validations.import_error",
        summary.errors,
        locale
      );
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Jobs — historical import with dedupe on jobCode / externalRef
// ---------------------------------------------------------------------------

export async function importJobs(
  prisma: PrismaClient,
  rows: unknown[],
  userId: string,
  locale: string
): Promise<ImportSummary> {
  const summary = emptySummary();
  for (const [index, raw] of rows.entries()) {
    const rowNo = index + 2;
    const parsed = jobImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      pushIssues(parsed.error, rowNo, summary.errors, locale);
      continue;
    }
    const row: JobImportRow = parsed.data;
    try {
      // Reimport safety: a jobCode or externalRef already on file means this
      // row was loaded before — skip it instead of creating a duplicate.
      if (row.jobCode) {
        const dupe = await prisma.job.findUnique({
          where: { jobCode: row.jobCode },
          select: { id: true },
        });
        if (dupe) {
          summary.skipped += 1;
          continue;
        }
      }
      if (row.externalRef) {
        const dupe = await prisma.job.findUnique({
          where: { externalRef: row.externalRef },
          select: { id: true },
        });
        if (dupe) {
          summary.skipped += 1;
          continue;
        }
      }
      await createImportedJob(
        prisma,
        {
          ...row,
          status: row.status as JobStatusType | undefined,
        },
        userId
      );
      summary.created += 1;
    } catch {
      pushRowError(
        rowNo,
        "",
        "validations.import_error",
        summary.errors,
        locale
      );
    }
  }
  return summary;
}
