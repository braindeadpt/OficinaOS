import { PartCategory } from "@shared/constants";
import { z } from "zod";

export const createPartSchema = z.object({
  name: z.string().min(1, { error: "validations.part_name_required" }),
  category: z.enum([
    PartCategory.SCREEN,
    PartCategory.BATTERY,
    PartCategory.CHARGING_PORT,
    PartCategory.CAMERA,
    PartCategory.SPEAKER,
    PartCategory.MICROPHONE,
    PartCategory.MOTHERBOARD,
    PartCategory.HOUSING,
    PartCategory.BUTTON,
    PartCategory.OTHER,
  ]),
  defaultPrice: z
    .number()
    .min(0, { error: "validations.price_positive" })
    .max(99_999_999.99),
  supplier: z.string().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
});

export const updatePartSchema = z.object({
  name: z.string().min(1).optional(),
  category: z
    .enum([
      PartCategory.SCREEN,
      PartCategory.BATTERY,
      PartCategory.CHARGING_PORT,
      PartCategory.CAMERA,
      PartCategory.SPEAKER,
      PartCategory.MICROPHONE,
      PartCategory.MOTHERBOARD,
      PartCategory.HOUSING,
      PartCategory.BUTTON,
      PartCategory.OTHER,
    ])
    .optional(),
  defaultPrice: z.number().min(0).max(99_999_999.99).optional(),
  supplier: z.string().optional(),
  isActive: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
});

export const listPartsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  needsRestock: z.coerce.boolean().optional(),
});

export const togglePartStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreatePartInput = z.infer<typeof createPartSchema>;
export type UpdatePartInput = z.infer<typeof updatePartSchema>;
export type ListPartsQueryInput = z.infer<typeof listPartsQuerySchema>;
export type TogglePartStatusInput = z.infer<typeof togglePartStatusSchema>;
