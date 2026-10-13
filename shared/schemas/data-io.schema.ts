import { z } from "zod";

/** Upper bound for one import batch — keeps a single POST under the body limit. */
export const IMPORT_MAX_ROWS = 1000;

const partImportRowSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(40).optional(),
  price: z.number().min(0).max(99_999_999.99).optional(),
  stock: z.number().int().min(0).max(999_999).optional(),
  supplier: z.string().max(120).optional(),
});

const repairImportRowSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(40).optional(),
  price: z.number().min(0).max(99_999_999.99).optional(),
  warrantyDays: z.number().int().min(0).max(3650).optional(),
});

const jobImportRowSchema = z.object({
  customerName: z.string().min(1).max(160),
  customerPhone: z.string().min(1).max(40),
  customerEmail: z.string().email().max(160).optional(),
  deviceBrand: z.string().max(80).optional(),
  deviceModel: z.string().min(1).max(120),
  problem: z.string().min(1).max(2000),
});

export const importPartsSchema = z.object({
  rows: z.array(partImportRowSchema).min(1).max(IMPORT_MAX_ROWS),
});

export const importRepairsSchema = z.object({
  rows: z.array(repairImportRowSchema).min(1).max(IMPORT_MAX_ROWS),
});

export const importJobsSchema = z.object({
  rows: z.array(jobImportRowSchema).min(1).max(IMPORT_MAX_ROWS),
});

export type PartImportRow = z.infer<typeof partImportRowSchema>;
export type RepairImportRow = z.infer<typeof repairImportRowSchema>;
export type JobImportRow = z.infer<typeof jobImportRowSchema>;
