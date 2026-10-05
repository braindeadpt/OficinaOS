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
  // Storefront+ (módulo pago "storefront-plus") — tema da montra. Os campos
  // são opcionais e ignorados sem o entitlement; a cloud revalida.
  accentColor: z
    .union([z.literal(""), z.string().regex(/^#[0-9a-f]{6}$/i)])
    .optional(),
  template: z.enum(["vitrine", "compacta"]).optional(),
  // Logo como data URL (≤~280KB). "" remove o logo.
  logo: z
    .union([
      z.literal(""),
      z
        .string()
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, {
          error: "storefront.logo_invalid",
        })
        .max(400_000),
    ])
    .optional(),
});

export type UpdateStorefrontInput = z.infer<typeof updateStorefrontSchema>;
