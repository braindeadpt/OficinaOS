import { z } from "zod";

// Loja online (Pro module "storefront") — config local da montra pública.
export const updateStorefrontSchema = z.object({
  published: z.boolean(),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  email: z
    .union([z.literal(""), z.string().trim().email().max(120)])
    .optional(),
  // Empty string = auto slug a partir do nome da loja.
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, { error: "validations.invalid_slug" })
    .optional()
    .or(z.literal("")),
});

export type UpdateStorefrontInput = z.infer<typeof updateStorefrontSchema>;
