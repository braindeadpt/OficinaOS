import { RepairCategory } from "@shared/constants";
import { z } from "zod";

/** Query-string boolean — z.coerce.boolean() maps "false" -> true. */
const stringBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const createRepairSchema = z.object({
  name: z
    .string()
    .min(1, { error: "validations.repair_name_required" })
    .max(120),
  category: z.enum([
    RepairCategory.HARDWARE,
    RepairCategory.SOFTWARE,
    RepairCategory.DIAGNOSTIC,
    RepairCategory.OTHER,
  ]),
  defaultPrice: z
    .number()
    .min(0, { error: "validations.price_positive" })
    .max(99_999_999.99),
});

export const updateRepairSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z
    .enum([
      RepairCategory.HARDWARE,
      RepairCategory.SOFTWARE,
      RepairCategory.DIAGNOSTIC,
      RepairCategory.OTHER,
    ])
    .optional(),
  defaultPrice: z.number().min(0).max(99_999_999.99).optional(),
  isActive: z.boolean().optional(),
});

export const listRepairsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  isActive: stringBoolean.optional(),
});

export const toggleRepairStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreateRepairInput = z.infer<typeof createRepairSchema>;
export type UpdateRepairInput = z.infer<typeof updateRepairSchema>;
export type ListRepairsQueryInput = z.infer<typeof listRepairsQuerySchema>;
export type ToggleRepairStatusInput = z.infer<typeof toggleRepairStatusSchema>;
