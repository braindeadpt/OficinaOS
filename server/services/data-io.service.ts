import type { PrismaClient } from "@generated/client";
import type { PartCategoryType, RepairCategoryType } from "@shared/constants";
import type {
  JobImportRow,
  PartImportRow,
  RepairImportRow,
} from "@shared/schemas/data-io.schema";
import { generateJobCode } from "../utils/job-code.js";

const PART_CATEGORIES = new Set([
  "SCREEN",
  "BATTERY",
  "CHARGING_PORT",
  "CAMERA",
  "SPEAKER",
  "MICROPHONE",
  "MOTHERBOARD",
  "HOUSING",
  "BUTTON",
  "OTHER",
]);

const REPAIR_CATEGORIES = new Set([
  "HARDWARE",
  "SOFTWARE",
  "DIAGNOSTIC",
  "OTHER",
]);

const GENERIC_BRAND = "Outra";
const CSV_NEEDS_QUOTES = /[",\n\r;]/;
const CSV_QUOTE = /"/g;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const s = String(value);
  return CSV_NEEDS_QUOTES.test(s) ? `"${s.replace(CSV_QUOTE, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(";")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(";"));
  }
  // BOM so Excel opens the file with the right encoding
  return `﻿${lines.join("\r\n")}`;
}

export async function exportJobsCsv(prisma: PrismaClient): Promise<string> {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true, phone: true, email: true } },
      device: { include: { brand: { select: { name: true } } } },
    },
    take: 50_000,
  });
  return toCsv(
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
    ],
    jobs.map((j) => [
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
      undefined,
    ])
  );
}

export async function exportPartsCsv(prisma: PrismaClient): Promise<string> {
  const parts = await prisma.partsCatalog.findMany({
    orderBy: { name: "asc" },
    take: 50_000,
  });
  return toCsv(
    [
      "name",
      "category",
      "price",
      "stock",
      "reorderLevel",
      "supplier",
      "active",
    ],
    parts.map((p) => [
      p.name,
      p.category,
      p.defaultPrice.toString(),
      p.stockQuantity,
      p.reorderLevel,
      p.supplier,
      p.isActive ? 1 : 0,
    ])
  );
}

export async function exportRepairsCsv(prisma: PrismaClient): Promise<string> {
  const repairs = await prisma.repairCatalog.findMany({
    orderBy: { name: "asc" },
    take: 50_000,
  });
  return toCsv(
    ["name", "category", "price", "warrantyDays", "active"],
    repairs.map((r) => [
      r.name,
      r.category,
      r.defaultPrice.toString(),
      r.warrantyDays,
      r.isActive ? 1 : 0,
    ])
  );
}

export interface ImportSummary {
  created: number;
  errors: { index: number; message: string }[];
  updated: number;
}

export async function importParts(
  prisma: PrismaClient,
  rows: PartImportRow[]
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, errors: [] };
  for (const [index, row] of rows.entries()) {
    try {
      const category: PartCategoryType =
        row.category && PART_CATEGORIES.has(row.category.toUpperCase())
          ? (row.category.toUpperCase() as PartCategoryType)
          : "OTHER";
      const data = {
        category,
        ...(row.price === undefined ? {} : { defaultPrice: row.price }),
        ...(row.stock === undefined ? {} : { stockQuantity: row.stock }),
        ...(row.supplier ? { supplier: row.supplier } : {}),
      };
      const existing = await prisma.partsCatalog.findFirst({
        where: { name: { equals: row.name, mode: "insensitive" } },
      });
      if (existing) {
        await prisma.partsCatalog.update({
          where: { id: existing.id },
          data,
        });
        summary.updated += 1;
      } else {
        await prisma.partsCatalog.create({
          data: { name: row.name, defaultPrice: 0, ...data },
        });
        summary.created += 1;
      }
    } catch (err) {
      summary.errors.push({
        index,
        message: err instanceof Error ? err.message : "error",
      });
    }
  }
  return summary;
}

export async function importRepairs(
  prisma: PrismaClient,
  rows: RepairImportRow[]
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, errors: [] };
  for (const [index, row] of rows.entries()) {
    try {
      const category: RepairCategoryType =
        row.category && REPAIR_CATEGORIES.has(row.category.toUpperCase())
          ? (row.category.toUpperCase() as RepairCategoryType)
          : "OTHER";
      const data = {
        category,
        ...(row.price === undefined ? {} : { defaultPrice: row.price }),
        ...(row.warrantyDays === undefined
          ? {}
          : { warrantyDays: row.warrantyDays }),
      };
      const existing = await prisma.repairCatalog.findFirst({
        where: { name: { equals: row.name, mode: "insensitive" } },
      });
      if (existing) {
        await prisma.repairCatalog.update({
          where: { id: existing.id },
          data,
        });
        summary.updated += 1;
      } else {
        await prisma.repairCatalog.create({
          data: { name: row.name, defaultPrice: 0, ...data },
        });
        summary.created += 1;
      }
    } catch (err) {
      summary.errors.push({
        index,
        message: err instanceof Error ? err.message : "error",
      });
    }
  }
  return summary;
}

export async function importJobs(
  prisma: PrismaClient,
  rows: JobImportRow[],
  userId: string
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, errors: [] };
  for (const [index, row] of rows.entries()) {
    try {
      await prisma.$transaction(async (tx) => {
        const phone = row.customerPhone.trim();
        const customer =
          (await tx.customer.findUnique({ where: { phone } })) ??
          (await tx.customer.create({
            data: {
              name: row.customerName.trim(),
              phone,
              email: row.customerEmail?.trim() || null,
            },
          }));

        const brand = await tx.brand.upsert({
          where: { name: row.deviceBrand?.trim() || GENERIC_BRAND },
          create: { name: row.deviceBrand?.trim() || GENERIC_BRAND },
          update: {},
        });
        const device = await tx.device.upsert({
          where: {
            brandId_model: { brandId: brand.id, model: row.deviceModel.trim() },
          },
          create: { brandId: brand.id, model: row.deviceModel.trim() },
          update: {},
        });
        const { jobCode, accessCode } = await generateJobCode(
          tx as PrismaClient
        );
        await tx.job.create({
          data: {
            jobCode,
            accessCode,
            customerId: customer.id,
            deviceId: device.id,
            reportedProblem: row.problem.trim(),
            status: "INTAKE",
            createdById: userId,
          },
        });
      });
      summary.created += 1;
    } catch (err) {
      summary.errors.push({
        index,
        message: err instanceof Error ? err.message : "error",
      });
    }
  }
  return summary;
}
