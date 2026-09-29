import { z } from "zod";

export const createCustomerSchema = z.object({
  email: z
    .string()
    .email({ error: "validations.email" })
    .optional()
    .or(z.literal("")),
  name: z.string().min(1, { error: "validations.enter_name" }),
  phone: z.string().min(1, { error: "validations.enter_phone" }),
  whatsappConsent: z.boolean().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
  name: z.string().min(1, { error: "validations.enter_name" }).optional(),
  phone: z.string().min(1, { error: "validations.enter_phone" }).optional(),
  email: z
    .string()
    .email({ error: "validations.email" })
    .or(z.literal(""))
    .optional(),
  whatsappConsent: z.boolean().optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerListQuerySchema = z.object({
  /** Filter by WhatsApp opt-in state: "true" = consented, "false" = not. */
  consent: z.enum(["true", "false"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export const customerSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const customerIdParamSchema = z.string().cuid();

export type CustomerListQueryInput = z.infer<typeof customerListQuerySchema>;
export type CustomerSearchQueryInput = z.infer<
  typeof customerSearchQuerySchema
>;
