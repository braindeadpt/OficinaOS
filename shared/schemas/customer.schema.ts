import { z } from "zod";

// Field caps — keep in sync with the maxLength on the customer forms.
export const CUSTOMER_NAME_MAX = 120;
export const CUSTOMER_PHONE_MAX = 32;
export const CUSTOMER_EMAIL_MAX = 254;
export const CUSTOMER_TAX_ID_MAX = 20;
const SEARCH_MAX = 100;

export const createCustomerSchema = z.object({
  email: z
    .string()
    .max(CUSTOMER_EMAIL_MAX)
    .email({ error: "validations.email" })
    .optional()
    .or(z.literal("")),
  name: z
    .string()
    .trim()
    .min(1, { error: "validations.enter_name" })
    .max(CUSTOMER_NAME_MAX),
  phone: z
    .string()
    .trim()
    .min(1, { error: "validations.enter_phone" })
    .max(CUSTOMER_PHONE_MAX),
  // NIF / VAT id — optional; enables proper invoices (FR) instead of FS.
  taxId: z
    .string()
    .trim()
    .max(CUSTOMER_TAX_ID_MAX)
    .optional()
    .or(z.literal("")),
  whatsappConsent: z.boolean().optional(),
  // A customer with the same (normalized) phone already exists → the API
  // answers 409 with its id. Set this to reuse that customer instead.
  useExisting: z.boolean().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "validations.enter_name" })
    .max(CUSTOMER_NAME_MAX)
    .optional(),
  phone: z
    .string()
    .trim()
    .min(1, { error: "validations.enter_phone" })
    .max(CUSTOMER_PHONE_MAX)
    .optional(),
  email: z
    .string()
    .max(CUSTOMER_EMAIL_MAX)
    .email({ error: "validations.email" })
    .or(z.literal(""))
    .optional(),
  taxId: z
    .string()
    .trim()
    .max(CUSTOMER_TAX_ID_MAX)
    .optional()
    .or(z.literal("")),
  whatsappConsent: z.boolean().optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerListQuerySchema = z.object({
  /** Filter by WhatsApp opt-in state: "true" = consented, "false" = not. */
  consent: z.enum(["true", "false"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(SEARCH_MAX).optional(),
});

export const customerSearchQuerySchema = z.object({
  q: z.string().min(1).max(SEARCH_MAX),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const customerIdParamSchema = z.string().cuid();

export type CustomerListQueryInput = z.infer<typeof customerListQuerySchema>;
export type CustomerSearchQueryInput = z.infer<
  typeof customerSearchQuerySchema
>;
