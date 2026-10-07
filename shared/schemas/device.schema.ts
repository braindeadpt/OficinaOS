import { z } from "zod";
import { DEVICE_CATEGORIES } from "../constants/device-categories";

export const brandSearchQuerySchema = z.object({
  q: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createBrandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "validations.enter_brand" })
    .max(100, { error: "validations.brand_too_long" }),
});

export const modelSearchQuerySchema = z.object({
  q: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createModelSchema = z.object({
  model: z
    .string()
    .trim()
    .min(1, { error: "validations.enter_model" })
    .max(200, { error: "validations.model_too_long" }),
  // Optional — a shop adding a model quickly may not pick; null = unknown.
  category: z.enum(DEVICE_CATEGORIES).optional(),
});

export const brandIdParamSchema = z.string().min(1);

export type BrandSearchQueryInput = z.infer<typeof brandSearchQuerySchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type ModelSearchQueryInput = z.infer<typeof modelSearchQuerySchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type BrandIdParamInput = z.infer<typeof brandIdParamSchema>;
