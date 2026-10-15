import { PartCategory } from "@shared/constants/part-categories";
import { RepairCategory } from "@shared/constants/repair-categories";
import { z } from "zod";

/** Upper bound for one import batch — keeps a single POST under the body limit. */
export const IMPORT_MAX_ROWS = 1000;

/** Client sends chunks of at most this many rows per request. */
export const IMPORT_CHUNK_SIZE = 500;

const PART_CATEGORY_KEYS = Object.keys(PartCategory) as [string, ...string[]];
const REPAIR_CATEGORY_KEYS = Object.keys(RepairCategory) as [
  string,
  ...string[],
];

const JOB_STATUSES = [
  "INTAKE",
  "WAITING_FOR_PARTS",
  "IN_REPAIR",
  "ON_HOLD",
  "DONE",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
] as const;

const PT_DATE_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

// Case-insensitive enum (trim + uppercase first), so lowercase CSVs still
// land on the right value.
const upperEnum = (values: readonly string[]) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.enum(values as [string, ...string[]])
  );

// ISO dates/datetimes plus the PT `dd/mm/yyyy` a migration CSV usually has.
const importedDate = z.preprocess(
  (v) => {
    if (typeof v !== "string") {
      return v;
    }
    const m = PT_DATE_RE.exec(v.trim());
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v;
  },
  z.union([z.iso.datetime(), z.iso.date()])
);

export const partImportRowSchema = z.object({
  name: z.string().min(1).max(120),
  category: upperEnum(PART_CATEGORY_KEYS).optional(),
  price: z.number().min(0).max(99_999_999.99).optional(),
  stock: z.number().int().min(0).max(999_999).optional(),
  reorderLevel: z.number().int().min(0).max(999_999).optional(),
  supplier: z.string().max(120).optional(),
  active: z.boolean().optional(),
});

export const repairImportRowSchema = z.object({
  name: z.string().min(1).max(160),
  category: upperEnum(REPAIR_CATEGORY_KEYS).optional(),
  price: z.number().min(0).max(99_999_999.99).optional(),
  warrantyDays: z.number().int().min(0).max(3650).optional(),
  active: z.boolean().optional(),
});

export const jobImportRowSchema = z.object({
  // jobCode / externalRef let a reimport recognise rows it already loaded —
  // a matching row is skipped instead of duplicated.
  jobCode: z.string().min(1).max(40).optional(),
  externalRef: z.string().min(1).max(80).optional(),
  customerName: z.string().min(1).max(160),
  customerPhone: z.string().min(1).max(40),
  customerEmail: z.string().email().max(160).optional(),
  deviceBrand: z.string().max(80).optional(),
  deviceModel: z.string().min(1).max(120),
  problem: z.string().min(1).max(2000),
  // Historical import fields — all optional; status defaults to DELIVERED.
  status: upperEnum(JOB_STATUSES).optional(),
  createdAt: importedDate.optional(),
  deliveredAt: importedDate.optional(),
});

// Payloads validate only the envelope — each row is safe-parsed
// individually in the service so one bad row never aborts the batch.
export const importPartsSchema = z.object({
  rows: z.array(z.unknown()).min(1).max(IMPORT_MAX_ROWS),
});

export const importRepairsSchema = importPartsSchema;
export const importJobsSchema = importPartsSchema;

export type PartImportRow = z.infer<typeof partImportRowSchema>;
export type RepairImportRow = z.infer<typeof repairImportRowSchema>;
export type JobImportRow = z.infer<typeof jobImportRowSchema>;

export interface ImportRowError {
  field: string;
  message: string;
  /** Spreadsheet row number — header is row 1, so the first data row is 2. */
  row: number;
}

export interface ImportSummary {
  created: number;
  errors: ImportRowError[];
  skipped: number;
  updated: number;
}
