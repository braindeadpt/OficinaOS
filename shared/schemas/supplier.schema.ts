import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160).optional(),
  phone: z.string().max(40).optional(),
  taxId: z.string().max(20).optional(),
  address: z.string().max(240).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const listSuppliersQuerySchema = z.object({
  search: z.string().max(120).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

export const SUPPLIER_RMA_STATUSES = [
  "OPEN",
  "SENT",
  "RECEIVED",
  "RESOLVED",
  "CANCELLED",
] as const;

export const createSupplierRmaSchema = z.object({
  supplierId: z.string().min(1),
  jobCode: z.string().trim().min(1).max(80).optional(),
  partId: z.string().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(9999).optional(),
  reason: z.string().max(500).optional(),
  reference: z.string().max(80).optional(),
});

export const updateSupplierRmaSchema = z.object({
  status: z.enum(SUPPLIER_RMA_STATUSES).optional(),
  reference: z.string().max(80).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  description: z.string().min(1).max(500).optional(),
  quantity: z.number().int().min(1).max(9999).optional(),
});

export const listSupplierRmasQuerySchema = z.object({
  supplierId: z.string().optional(),
  jobId: z.string().optional(),
  status: z.enum(SUPPLIER_RMA_STATUSES).optional(),
});
