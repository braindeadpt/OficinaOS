import { z } from "zod";

// Loaner fleet unit — the "label" is what staff recognise and what lands
// on the printed responsibility term when no free-text note is given.
export const createLoanerDeviceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(60).optional(),
  model: z.string().trim().max(120).optional(),
  imei: z.string().trim().max(32).optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateLoanerDeviceInput = z.infer<typeof createLoanerDeviceSchema>;

export const updateLoanerDeviceSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  brand: z.string().trim().max(60).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  imei: z.string().trim().max(32).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export type UpdateLoanerDeviceInput = z.infer<typeof updateLoanerDeviceSchema>;
